# MQTT Bridge

Dieses Projekt dient als Brücke zwischen einem MQTT-Broker und einer Supabase-Datenbank. Es empfängt MQTT-Nachrichten von den verschiedenen Posten, verarbeitet sie und aktualisiert die entsprechenden Einträge in der Supabase-Datenbank.

## Device IDs

Devices sind die Geräte, also die Posten, die MQTT-Nachrichten senden. Jedes Gerät hat eine eindeutige ID und ist mit einem bestimmten Posten in der Supabase-Datenbank verknüpft. Der Name der MQTT-Topics, die von den Geräten gesendet werden, enthält die ID des Geräts, damit die Brücke die Nachrichten korrekt zuordnen kann. 

Der Name wird für ESP32 über main.cpp im platformio.ini definiert. 

