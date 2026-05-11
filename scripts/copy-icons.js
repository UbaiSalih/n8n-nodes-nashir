const fs = require('fs');
const path = require('path');

const nodes = [
  'NashirContact',
  'NashirFacebook',
  'NashirInstagram',
  'NashirLinkedIn',
  'NashirTelegram',
  'NashirThreads',
  'NashirTikTok',
  'NashirWhatsApp',
  'NashirYouTube',
];

for (const node of nodes) {
  const src = path.join(__dirname, '..', 'nodes', node, 'nashir.svg');
  const dest = path.join(__dirname, '..', 'dist', 'nodes', node, 'nashir.svg');
  fs.copyFileSync(src, dest);
  console.log(`Copied nashir.svg → dist/nodes/${node}/`);
}
