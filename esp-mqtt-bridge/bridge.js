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
  client.subscribe(["status/+", "tasks/+"], (err) => {
    if (err) log("error", "Subscription failed", err);
    else log("info", "Subscribed to topics: status/+ and tasks/+");
  });
});

client.on("error", (err) => log("error", "MQTT Connection error", err));

client.on("message", async (topic, msg) => {
  const payload = msg.toString();
  log("debug", `Inbound MQTT -> ${topic}: ${payload}`);

  try {
    if (topic.startsWith("status/")) {
      const deviceId = topic.split("/")[1];
      let status = 0;
      let ipAdress = null;
      if (payload.length > 1) {
        const { s: statusValue, ip } = JSON.parse(payload);
        status = statusValue;
        ipAdress = ip;
      } else {
        status = payload === "1";
      }
      await updateStatus(deviceId, status, ipAdress);
    }

    if (topic.startsWith("tasks/")) {
      const deviceId = topic.split("/")[1];
      let { c: characterRfid } = JSON.parse(payload);

      characterRfid = characterRfid
        .replace(/[:-]/g, "") // entfernt alle ":" und "-"
        .substring(0, 8); // auf 8 Zeichen kürzen

      await updateTask(characterRfid, deviceId);
    }
  } catch (err) {
    log("error", `PROCESS ERROR: ${err.message}`);
  }

  /**
   * HELPER FUNCTIONS
   */

  /**
   * Updates the online status of a device in the Supabase Devices table.
   * @param {string} deviceId - The unique identifier of the device
   * @param {boolean} status - The online status (true = online, false = offline)
   * @param {string} ip - The IP address of the device (optional)
   * @throws {Error} Throws if the database operation fails
   * @returns {Promise<void>}
   */
  async function updateStatus(deviceId, status, ip = null) {
    log("debug", `Supabase -> Upserting status for ${deviceId}`);

    const updateData = { id: deviceId, online: status, last_seen: new Date() };
    if (ip) updateData.ip = ip;

    const { error } = await supabase.from("Devices").upsert(updateData);

    if (error) throw error;
    log("info", `Device ${deviceId} status updated: ${status ? "online" : "offline"}`);
  }

  /**
   * Marks a task as solved in the Supabase Task table based on character and supervisor RFIDs.
   * @param {string} characterRfid - The RFID of the character
   * @param {string} deviceId - The unique identifier of the device
   * @throws {Error} Throws if any database operation fails
   * @returns {Promise<void>}
   */
  async function updateTask(characterRfid, deviceId) {
    log("info", `Task Request -> Char: ${characterRfid}`);

    const { data: gameData, error: gErr } = await supabase.from("Game").select("id, gametype").eq("is_active", true).single();

    if (gErr || !gameData) throw new Error("No active game found");

    const { data: characterData, error: cErr } = await supabase.from("Character").select("id").eq("rfid", characterRfid).single();

    if (cErr || !characterData) {
      throw new Error(`Character lookup failed for RFID ${characterRfid}`);
    }

    const { data: postData, error: pErr } = await supabase.from("Post").select("id").eq("gametype", gameData.gametype).eq("device", deviceId).single();

    if (pErr || !postData) {
      throw new Error(`Post lookup failed for device ${deviceId} in gametype ${gameData.gametype}`);
    }

    const { error: uErr } = await supabase.from("Task").update({ solved: true }).match({
      game: gameData.id,
      character: characterData.id,
      post: postData.id,
    });

    if (uErr) throw uErr;

    log("info", `SUCCESS: Task solved for Char ${characterRfid}`);
  }
});
