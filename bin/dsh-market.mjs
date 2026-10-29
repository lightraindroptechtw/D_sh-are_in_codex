#!/usr/bin/env node
import {openPluginMarket} from '../lib/plugin-market-entry.mjs';
try{console.log(JSON.stringify(await openPluginMarket()));}
catch(cause){console.error(JSON.stringify({error:cause.message}));process.exitCode=1;}
