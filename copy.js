const fs = require('fs');
const oldSrv = fs.readFileSync('C:/Users/Lakshya/Desktop/New Project prayogam/server.js', 'utf8');
const match = oldSrv.match(/app\.get\('\/api\/airspace', \(req, res\) => \{[\s\S]*?res\.json\(\{ zones, timestamp: Date\.now\(\) \}\);\s*\}\);/);
if(match) {
  let newSrv = fs.readFileSync('server.js', 'utf8');
  if(!newSrv.includes('/api/airspace')) {
    newSrv = newSrv.replace('app.listen(PORT', match[0] + '\n\napp.listen(PORT');
    fs.writeFileSync('server.js', newSrv);
    console.log('Successfully injected /api/airspace');
  } else {
    console.log('Already injected');
  }
} else {
  console.log('Match failed');
}
