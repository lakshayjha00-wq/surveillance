import asyncio
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from contextlib import asynccontextmanager

# --- CONFIGURATION ---
# Polling flights within a 50 nautical mile radius of London (Lat: 51.5, Lon: -0.12)
ADSB_API_URL = "https://api.adsb.lol/v2/point/51.5/-0.12/50"
POLLING_INTERVAL_SEC = 5  # How often to fetch from the API
STREAMING_INTERVAL_SEC = 2  # How often to push to WebSocket clients

# Global state to hold the latest telemetry
system_state = {
    "live_flights": []
}
active_connections = set()

# --- BACKGROUND WORKER ---
async def poll_flight_data():
    """Continuously polls the OSINT feed in the background."""
    async with httpx.AsyncClient() as client:
        while True:
            try:
                response = await client.get(ADSB_API_URL, timeout=10.0)
                if response.status_code == 200:
                    data = response.json()
                    # The 'ac' key contains the list of aircraft in the adsb.lol payload
                    system_state["live_flights"] = data.get("ac", [])
                    print(f"[Engine] Updated: {len(system_state['live_flights'])} aircraft tracked.")
                else:
                    print(f"[Engine] Upstream Error: {response.status_code}")
            except Exception as e:
                print(f"[Engine] Network Exception: {e}")
            
            # Wait before hitting the API again to respect rate limits
            await asyncio.sleep(POLLING_INTERVAL_SEC)


# --- LIFECYCLE MANAGEMENT ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start the polling worker when the server boots
    polling_task = asyncio.create_task(poll_flight_data())
    yield
    # Clean up when the server shuts down
    polling_task.cancel()

app = FastAPI(title="Godseye Data Engine", lifespan=lifespan)


# --- WEBSOCKET STREAMING ---
@app.websocket("/ws/telemetry")
async def telemetry_stream(websocket: WebSocket):
    """Pushes the latest system state to connected frontend clients."""
    await websocket.accept()
    active_connections.add(websocket)
    print(f"[Socket] Client connected. Total active: {len(active_connections)}")
    
    try:
        while True:
            # Stream the most recent data block
            await websocket.send_json({
                "type": "telemetry_update",
                "count": len(system_state["live_flights"]),
                "data": system_state["live_flights"]
            })
            # Control the framerate of the frontend updates
            await asyncio.sleep(STREAMING_INTERVAL_SEC)
            
    except WebSocketDisconnect:
        active_connections.remove(websocket)
        print("[Socket] Client disconnected.")