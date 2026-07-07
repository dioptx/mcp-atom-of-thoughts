#!/bin/sh
# Fixture SGT_BIN: emits a >2MB plan — exceeds Node's 1MB default maxBuffer,
# proving the bridge raises it (16MB).
exec node -e 'const skills=[];for(let i=0;i<20000;i++)skills.push({slug:"skill-"+i,score:50,pad:"x".repeat(80)});process.stdout.write(JSON.stringify({query:"big",decisionTree:[],skills}))'
