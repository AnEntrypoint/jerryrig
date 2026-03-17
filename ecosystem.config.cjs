module.exports = {
  apps: [{
    name: 'screens',
    script: 'node_modules/electron/dist/electron.exe',
    args: '. --remote-debugging-port=9229 --remote-debugging-address=127.0.0.1',
    cwd: 'C:/dev/screens',
    env_file: '.env',
    autorestart: false,
  }]
}
