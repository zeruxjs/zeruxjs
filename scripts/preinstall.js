const { execSync } = require('child_process');

console.log('Running preinstall tasks...');
try {
  // Build and start the docker container in the background
  console.log('Building and setting up the docker dev environment...');
  
  // Use docker compose to build the image and bring the container up detached
  execSync('docker compose up -d --build zerux-dev-env', { stdio: 'inherit' });
  
  console.log('Docker dev environment is successfully set up.');
} catch (error) {
  console.warn('Handling skipped: Failed to setup docker dev environment. Make sure Docker is running.');
  console.warn(error.message);
  // We exit normally (0) so we don't block the host package installation
}
