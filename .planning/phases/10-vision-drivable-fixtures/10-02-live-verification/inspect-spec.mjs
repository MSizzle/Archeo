import { readFileSync } from 'node:fs'
const p = process.argv[2]
const s = JSON.parse(readFileSync(p, 'utf8'))
const keys = ['meta','dataModels','endpoints','flows','rules','coverage']
const missing = keys.filter(k => !(k in s))
console.log('FILE:', p)
console.log('top-level keys present:', Object.keys(s).join(', '))
console.log('missing required keys:', missing.length ? missing.join(',') : '(none)')
const eps = s.endpoints || []
const held = eps.filter(e => e.held === true)
const templated = eps.filter(e => /\{[^}]+\}/.test(e.pathTemplate || e.path || ''))
console.log('endpoints:', eps.length, '| held:', held.length, '| templated:', templated.length)
eps.forEach(e => console.log('   ', (e.method||'?'), (e.pathTemplate||e.path||'?'), e.held?'[HELD]':'', e.operationType?('('+e.operationType+')'):''))
console.log('dataModels:', (s.dataModels||[]).map(m=>m.name+'('+(m.fields||[]).length+'f)').join(', '))
const fl = s.flows||{}
console.log('flows.states:', (fl.states||[]).length, '->', (fl.states||[]).map(x=>x.name||x.id).join(','))
console.log('flows.transitions:', (fl.transitions||[]).length)
console.log('rules:', (s.rules||[]).map(r=>r.rule).join(' | '))
console.log('coverage:', JSON.stringify(s.coverage))
