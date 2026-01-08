const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client = mqtt.connect(`mqtts://${process.env.MQTT_HOST}`, {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASSWORD,
  port: 8883
});

client.on('connect', () => {
  client.subscribe(['status/+', 'tasks/update']);
});

client.on('message', async (topic, msg) => {
  try {
    const payload = msg.toString();

    if (topic.startsWith('status/')) {
      const espId = topic.split('/')[1];
      await supabase.from('devices').upsert({ id: espId, online: payload === '1', last_seen: new Date() });
    } 

    if (topic === 'tasks/update') {
      const { c: character, s: supervisor } = JSON.parse(payload); // ESP sendet nur RFIDs

      // 1. Supervisor ID holen
      const { data: sData } = await supabase.from('Supervisor').select('id').eq('rfid', supervisor).single();
      
      // 2. Aktives Game holen
      const { data: gData } = await supabase.from('Game').select('id').eq('is_active', true).single();
      
      // 3. Post IDs holen
      const { data: pData } = await supabase.from('Post').select('id').eq('supervisor', sData.id);
      const postIds = pData.map(p => p.id);

      // 4. Character ID holen
      const { data: cData } = await supabase.from('Character').select('id').eq('rfid', character).single();

      // 5. Task updaten
      await supabase.from('Task').update({ solved: true })
        .in('post', postIds)
        .match({ game: gData.id, character: cData.id });

      console.log(`Task solved for Character ${character}`);
    }
  } catch (err) {
    console.error("Bridge Error:", err.message);
  }
});