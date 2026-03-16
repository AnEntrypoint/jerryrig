module.exports = {
  apps: [{
    name: 'screens',
    script: 'node_modules/electron/dist/electron.exe',
    args: '.',
    cwd: 'C:/dev/screens',
    env_file: '.env',
    autorestart: false,
  }]
}
