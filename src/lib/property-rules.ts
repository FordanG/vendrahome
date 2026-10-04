/** Initial property policy. Published copies are editable by the admin in House rules. */
export const PROPERTY_RULES = [
  {
    title: "No cooking in rooms",
    body: "Cooking and heating meals are not allowed inside guest rooms. Do not use rice cookers, hot plates, portable stoves, grills or other cooking appliances in rooms. Prepare and heat food only in the designated shared kitchen during its posted hours.",
  },
  {
    title: "No visitors allowed",
    body: "Visitors are not allowed on the property or inside guest rooms, including daytime and overnight visits. Do not invite friends, relatives or unregistered guests into the building. Access is limited to registered residents and authorized property staff and service providers. Meet deliveries at the designated reception or collection area; do not bring delivery riders into residential areas.",
  },
  {
    title: "Quiet hours",
    body: "Quiet hours are 10 PM to 7 AM. Keep conversations, music, calls and television at a low volume. Avoid loud gatherings at all times and respect residents who sleep during the day because of their work shifts.",
  },
  {
    title: "Respectful conduct",
    body: "Treat residents, staff and service providers respectfully. Harassment, threats, fighting, discrimination and illegal activity are not allowed. Raise concerns with the front desk instead of confronting or disturbing other residents.",
  },
  {
    title: "Assigned rooms and shared spaces",
    body: "Use only your assigned room and bed. Room or bed changes must be arranged through the front desk. Keep belongings in your own storage area, respect roommates' privacy and do not enter another resident's room without their permission. Do not allow an unregistered person to stay in your place.",
  },
  {
    title: "No indoor smoking or vaping",
    body: "Smoking and vaping are not allowed anywhere inside the building, including rooms, bathrooms, corridors, stairs and shared facilities. Do not discard cigarette ends or smoking materials on the property.",
  },
  {
    title: "Fire safety and clear exits",
    body: "Keep corridors, stairs, exits and access to fire equipment clear at all times. Candles, incense, open flames and fuel-burning appliances are not allowed in rooms. Do not tamper with alarms, detectors, extinguishers or electrical fittings. Report smoke, burning smells or damaged electrical equipment to staff immediately.",
  },
  {
    title: "Room cleanliness and waste",
    body: "Keep your room and bathroom clean. Store food in closed containers and dispose of waste regularly in the designated bins. Separate waste according to the labels provided. Do not leave garbage, shoes, furniture or laundry in corridors, and do not throw anything from windows.",
  },
  {
    title: "Shared kitchen",
    body: "Follow the kitchen timetable posted in the app or by management. Do not leave cooking unattended. Wash and put away utensils, clean the stove and counters, and switch off equipment after use. Label stored food with your name and room number and remove expired food. Do not take other residents' food or belongings.",
  },
  {
    title: "Laundry and drying",
    body: "Follow the posted laundry pickup and return arrangements. Label each bag with your name, room number and bed, and remove valuables before handover. Confirm service arrangements and any charges with the front desk in advance. Request a different pickup time through the app or front desk. Use only designated drying areas; do not hang laundry over windows, railings or fire equipment.",
  },
  {
    title: "Keys, access and personal belongings",
    body: "Keep your keys or access cards secure. Do not lend them, copy them or share your app password. Keep your room locked when leaving and do not hold secured doors open for unregistered people. Report lost keys or cards immediately and keep valuables in your own secure storage.",
  },
  {
    title: "Care of the property",
    body: "Use furniture, appliances and fittings carefully. Do not drill, paint, alter wiring, move hotel items to another room or make repairs yourself without management approval. Report accidental damage, missing items, leaks or faults promptly. Do not flush wipes, sanitary products, food or other waste down toilets or drains.",
  },
  {
    title: "Maintenance visits and privacy",
    body: "Cooperate with scheduled cleaning, inspections and repairs, and keep the work area accessible. Staff and service providers must identify themselves and knock before entering. Routine room access should be arranged with residents in advance. Ask the front desk to verify an unfamiliar worker before allowing entry.",
  },
  {
    title: "Report concerns and urgent problems",
    body: "Use the app or speak to the front desk to report maintenance issues, service concerns or a breach of these rules. For urgent problems, contact the front desk directly rather than waiting for an app reply. Give the room number and a clear description so staff can respond promptly.",
  },
  {
    title: "Before leaving or checking out",
    body: "Switch off lights and appliances that do not need to remain on, close taps and secure your room when leaving. Inform the front desk of your planned move-out date. At checkout, remove your belongings and waste, return all issued keys or cards, and arrange the room check with staff.",
  },
].map((rule, index) => ({ ...rule, position: index + 1 }));
