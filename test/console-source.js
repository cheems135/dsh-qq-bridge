import fs from 'node:fs';
export function readConsoleSource(){return fs.readFileSync(new URL('../console.html',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('../ui/console-controller.js',import.meta.url),'utf8');}
