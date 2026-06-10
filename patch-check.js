// patch-check.js — averigua los nombres reales de los campos de /v1/patches
// Uso: node patch-check.js
const https = require('https');
https.get('https://api.deadlock-api.com/v1/patches', res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      const arr = Array.isArray(data) ? data : (data.patches || []);
      console.log('Total de parches recibidos:', arr.length);
      console.log('');
      console.log('=== CAMPOS (keys) del primer parche ===');
      console.log(Object.keys(arr[0] || {}));
      console.log('');
      console.log('=== PRIMER PARCHE COMPLETO ===');
      console.log(JSON.stringify(arr[0], null, 2).slice(0, 3000));
    } catch (e) {
      console.log('Error al parsear:', e.message);
      console.log('Respuesta cruda (primeros 500 chars):');
      console.log(body.slice(0, 500));
    }
  });
}).on('error', e => console.log('Error de conexión:', e.message));
