FROM performanc/nodelink:latest

RUN node <<'SCRIPT'
const fs = require('fs');

let u = fs.readFileSync('src/utils.ts', 'utf8');
u = u.replace(
  /nodelinkLoad: Number\.parseFloat\(\(aggregatedNodelinkLoad \/ cores\)\.toFixed\(2\)\)/,
  m => m + ',\n    lavalinkLoad: Number.parseFloat((aggregatedNodelinkLoad / cores).toFixed(2))'
);
fs.writeFileSync('src/utils.ts', u);

let m = fs.readFileSync('src/workers/main.ts', 'utf8');
m = m.replace('cpu: { nodelinkLoad }', 'cpu: { nodelinkLoad, lavalinkLoad: nodelinkLoad }');
fs.writeFileSync('src/workers/main.ts', m);
SCRIPT
