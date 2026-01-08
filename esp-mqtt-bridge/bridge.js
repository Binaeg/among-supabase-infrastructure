const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');

const LOG_LEVELS = { none: 0, error: 1, info: 2, debug: 3 };
const CURRENT_LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] || LOG_LEVELS.info;

const log = (level, ...args) => {
  if (LOG_LEVELS[level] <= CURRENT_LOG_LEVEL) {
    console.log(`[${level.toUpperCase()}]`, ...args);
  }
};

log('info', 'Initializing Supabase connection...');

// Client Erstellung
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
log('info', 'Supabase client object created');

// Sofortiger Verbindungstest beim Start
async function testConnection() {
  log('debug', `Testing connection to: ${process.env.SUPABASE_URL}`);
  const { data, error } = await supabase.from('Devices').select('count').limit(1);
  if (error) {
    log('error', 'CRITICAL: Could not reach Supabase!', error.message);
    log('error', 'Check if SUPABASE_URL is correct and Kong container is running.');
  } else {
    log('info', 'Supabase connection test successful');
  }
}
testConnection();

const client = mqtt.connect(`mqtts://${process.env.MQTT_HOST}`, {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASSWORD,
  port: 8883,
  rejectUnauthorized: true
});

client.on('connect', () => {
  log('info', 'Connected to HiveMQ Cloud');
  client.subscribe(['status/+', 'tasks/update'], (err) => {
    if (err) log('error', 'Subscription failed', err);
    else log('info', 'Subscribed to topics: status/+ and tasks/update');
  });
});

client.on('error', (err) => log('error', 'MQTT Connection error', err));

client.on('message', async (topic, msg) => {
  const payload = msg.toString();
  log('debug', `Inbound MQTT -> ${topic}: ${payload}`);

  try {
    if (topic.startsWith('status/')) {
      const espId = topic.split('/')[1];
      log('debug', `Supabase -> Upserting status for ${espId}`);
      
      const { error } = await supabase.from('Devices')
        .upsert({ id: espId, online: payload === '1', last_seen: new Date() });
      
      if (error) throw error;
      log('info', `Device ${espId} status updated: ${payload === '1' ? 'online' : 'offline'}`);
    } 

    if (topic === 'tasks/update') {
      const { c, s } = JSON.parse(payload);
      log('info', `Task Request -> Char: ${c}, Super: ${s}`);

      const { data: sData, error: sErr } = await supabase.from('Supervisor').select('id').eq('rfid', s).single();
      if (sErr || !sData) throw new Error(`Supervisor lookup failed for RFID ${s}`);
      
      const { data: gData, error: gErr } = await supabase.from('Game').select('id').eq('is_active', true).single();
      if (gErr || !gData) throw new Error('No active game found');
      
      const { data: pData, error: pErr } = await supabase.from('Post').select('id').eq('supervisor', sData.id);
      if (pErr) throw pErr;
      const postIds = pData.map(p => p.id);

      const { data: cData, error: cErr } = await supabase.from('Character').select('id').eq('rfid', c).single();
      if (cErr || !cData) throw new Error(`Character lookup failed for RFID ${c}`);

      const { error: uErr } = await supabase.from('Task').update({ solved: true })
        .in('post', postIds)
        .match({ game: gData.id, character: cData.id });

      if (uErr) throw uErr;
      log('info', `SUCCESS: Task solved for Char ${c}`);
    }
  } catch (err) {
    log('error', `PROCESS ERROR: ${err.message}`);
  }
});