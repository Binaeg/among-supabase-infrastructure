const mqtt = require("mqtt");
const { createClient } = require("@supabase/supabase-js");
const { log, LOG_LEVELS, CURRENT_LOG_LEVEL } = require("./logger");

log("info", "Initializing Supabase connection...");

// Client Erstellung
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
log("info", "Supabase client object created");

if (CURRENT_LOG_LEVEL >= LOG_LEVELS.debug) {
  // Sofortiger Verbindungstest beim Start in level debug
  async function testConnection() {
    log("debug", `Testing connection to: ${process.env.SUPABASE_URL}`);
    const { error } = await supabase.from("Devices").select("count").limit(1);
    if (error) {
      log("error", "CRITICAL: Could not reach Supabase!", error.message);
      log("error", "Check if SUPABASE_URL is correct and Kong container is running.");
    } else {
      log("info", "Supabase connection test successful");
    }
  }

  testConnection();
}

const client = mqtt.connect(`mqtts://${process.env.MQTT_HOST}`, {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASSWORD,
  port: 8883,
  rejectUnauthorized: true,
});

client.on("connect", () => {
  log("info", "Connected to HiveMQ Cloud");
  client.subscribe(["status/+", "tasks/update"], (err) => {
    if (err) log("error", "Subscription failed", err);
    else log("info", "Subscribed to topics: status/+ and tasks/update");
  });
});

client.on("error", (err) => log("error", "MQTT Connection error", err));

client.on("message", async (topic, msg) => {
  const payload = msg.toString();
  log("debug", `Inbound MQTT -> ${topic}: ${payload}`);

  try {
    if (topic.startsWith("status/")) {
      const espId = topic.split("/")[1];
      const status = payload === "1";
      await updateStatus(espId, status);
    }

    if (topic === "tasks/update") {
      const { c: characterRfid, s: supervisorRfid } = JSON.parse(payload);
      await updateTask(characterRfid, supervisorRfid);
    }
  } catch (err) {
    log("error", `PROCESS ERROR: ${err.message}`);
  }

  /**
   * HELPER FUNCTIONS
   */

  /**
   * Updates the online status of a device in the Supabase Devices table.
   * @param {string} espId - The unique identifier of the ESP device
   * @param {boolean} status - The online status (true = online, false = offline)
   * @throws {Error} Throws if the database operation fails
   * @returns {Promise<void>}
   */
  async function updateStatus(espId, status) {
    log("debug", `Supabase -> Upserting status for ${espId}`);

    const { error } = await supabase.from("Devices").upsert({ id: espId, online: status, last_seen: new Date() });

    if (error) throw error;
    log("info", `Device ${espId} status updated: ${status ? "online" : "offline"}`);
  }

  /**
   * Marks a task as solved in the Supabase Task table based on character and supervisor RFIDs.
   * @param {string} characterRfid - The RFID of the character
   * @param {string} supervisorRfid - The RFID of the supervisor
   * @throws {Error} Throws if any database operation fails
   * @returns {Promise<void>}
   */
  async function updateTask(characterRfid, supervisorRfid) {
    log("info", `Task Request -> Char: ${characterRfid}, Super: ${supervisorRfid}`);

    const { data: sData, error: sErr } = await supabase.from("Supervisor").select("id").eq("rfid", supervisorRfid).single();
    if (sErr || !sData) throw new Error(`Supervisor lookup failed for RFID ${supervisorRfid}`);

    const { data: gData, error: gErr } = await supabase.from("Game").select("id").eq("is_active", true).single();
    if (gErr || !gData) throw new Error("No active game found");

    const { data: pData, error: pErr } = await supabase.from("Post").select("id").eq("supervisor", sData.id);
    if (pErr) throw pErr;
    const postIds = pData.map((p) => p.id);

    const { data: cData, error: cErr } = await supabase.from("Character").select("id").eq("rfid", characterRfid).single();
    if (cErr || !cData) throw new Error(`Character lookup failed for RFID ${characterRfid}`);

    const { error: uErr } = await supabase.from("Task").update({ solved: true }).in("post", postIds).match({ game: gData.id, character: cData.id });

    if (uErr) throw uErr;
    log("info", `SUCCESS: Task solved for Char ${characterRfid}`);
  }
});
