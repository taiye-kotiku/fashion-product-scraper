// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'fashion-agent-scheduler',
      script: 'src/scheduler/CronManager.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      },
      // Restart policy
      exp_backoff_restart_delay: 5000,
      max_restarts: 10,
      restart_delay: 5000,
      // Logs
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Graceful shutdown
      kill_timeout: 60000, // Wait 60s for graceful shutdown
      listen_timeout: 10000
    }
  ]
};