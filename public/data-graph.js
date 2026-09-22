let network = null;

// Node styling based on groups
const groups = {
    zone: {
        shape: 'box',
        color: { background: '#1e293b', border: '#38bdf8' },
        font: { color: '#f8fafc', size: 16, bold: true },
        borderWidth: 2,
        shadow: true
    },
    news: {
        shape: 'box',
        color: { background: '#334155', border: '#94a3b8' },
        font: { color: '#e2e8f0', size: 12 },
        borderWidth: 1
    },
    weather: {
        shape: 'box',
        color: { background: '#0284c7', border: '#7dd3fc' },
        font: { color: '#f0f9ff', size: 12 },
        borderWidth: 1
    },
    traffic: {
        shape: 'box',
        color: { background: '#b45309', border: '#fcd34d' },
        font: { color: '#fffbeb', size: 12 },
        borderWidth: 1
    },
    intel: {
        shape: 'box',
        color: { background: '#9f1239', border: '#fda4af' },
        font: { color: '#fff1f2', size: 12 },
        borderWidth: 1
    },
    outcome: {
        shape: 'circle',
        color: { background: '#000000', border: '#ff3333' }, // will be overridden by inline colors
        font: { color: '#ffffff', size: 14, bold: true },
        borderWidth: 3,
        shadow: { enabled: true, color: 'rgba(255,0,0,0.5)', size: 10 }
    }
};

window.openKnowledgeGraph = async function(zoneId, zoneName, event) {
    if (event) {
        event.stopPropagation(); // prevent map flyTo
    }

    const modal = document.getElementById('knowledgeGraphModal');
    const container = document.getElementById('knowledgeGraphContainer');
    const titleSpan = document.getElementById('kgZoneName');
    
    titleSpan.innerText = `— ${zoneName}`;
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    
    // Show loading
    container.innerHTML = '<div style="color: #94a3b8; text-align: center; padding-top: 20%;">Analyzing cross-correlation pipelines...</div>';
    
    try {
        const response = await fetch(`/api/knowledge-graph/${zoneId}`);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to fetch graph');
        }
        
        container.innerHTML = ''; // clear loading

        const visNodes = new vis.DataSet(data.nodes);
        const visEdges = new vis.DataSet(data.edges.map(e => ({
            ...e,
            font: { align: 'middle', color: '#94a3b8', size: 10 },
            arrows: 'to',
            color: { color: '#475569', highlight: '#94a3b8' }
        })));
        
        const graphData = {
            nodes: visNodes,
            edges: visEdges
        };
        
        const options = {
            groups: groups,
            layout: {
                hierarchical: false
            },
            physics: {
                forceAtlas2Based: {
                    gravitationalConstant: -100,
                    centralGravity: 0.01,
                    springLength: 200,
                    springConstant: 0.08
                },
                maxVelocity: 50,
                solver: 'forceAtlas2Based',
                timestep: 0.35,
                stabilization: { iterations: 150 }
            },
            interaction: {
                hover: true,
                tooltipDelay: 200
            }
        };
        
        network = new vis.Network(container, graphData, options);
        
        // Add outcome color overrides
        data.nodes.forEach(n => {
            if (n.group === 'outcome' && n.color) {
                visNodes.update({ id: n.id, color: { background: '#1e293b', border: n.color } });
            }
        });
        
    } catch (err) {
        container.innerHTML = `<div style="color: #ef4444; text-align: center; padding-top: 20%;">Error: ${err.message}</div>`;
    }
};

document.getElementById('kgCloseBtn').addEventListener('click', () => {
    document.getElementById('knowledgeGraphModal').classList.add('hidden');
    document.getElementById('knowledgeGraphModal').style.display = 'none';
    if (network) {
        network.destroy();
        network = null;
    }
});
