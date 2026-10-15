const { execSync } = require('child_process');

console.log('Running preinstall tasks...');
try {
  // Check if the image already exists
  const imageExists = execSync('docker images -q zeruxjs-dev-env').toString().trim();
  
  if (!imageExists) {
      console.log('Building and setting up the docker dev environment for the first time...');
      execSync('docker compose up -d --build zerux-dev-env', { stdio: 'inherit' });
  } else {
      console.log('Docker image already exists. Skipping compose building altogether...');
      // Start it only if not running
      execSync('docker compose up -d zerux-dev-env', { stdio: 'inherit' });
  }
  
  console.log('Docker dev environment is successfully set up.');
} catch (error) {
  console.warn('Handling skipped: Failed to setup docker dev environment. Make sure Docker is running.');
  // We exit normally (0) so we don't block the host package installation
}
