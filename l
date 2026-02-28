const fs=require('fs');const p='.env';if(!fs.existsSync(p)){console.log('MISSING_ENV_FILE');process.exit(0);}const keys=fs.readFileSync(p,'utf8').split(/\r?\n/).map(l=
