/**
 * Starting house rules, used by the demo. The admin edits the real ones in House rules.
 * Short and plain on purpose: many tenants read English as a second language.
 * Lines starting with "- " show as a bulleted list.
 */
export const PROPERTY_RULES = [
  {
    title: "No cooking in rooms",
    body: "- No rice cookers, hot plates, stoves or grills in rooms.\n- Cook and heat food only in the shared kitchen, at your kitchen times.",
  },
  {
    title: "No visitors",
    body: "- Only tenants and hotel staff may come inside.\n- No friends or family in the building, day or night.\n- Meet delivery riders at the front desk.",
  },
  {
    title: "Quiet hours: 10 PM to 7 AM",
    body: "- Keep music, calls and TV low.\n- Some tenants sleep in the day after night shifts. Please keep it quiet then too.",
  },
  {
    title: "Be respectful",
    body: "- Be kind to other tenants and to staff.\n- No fighting, threats or harassment.\n- If there is a problem, tell the front desk.",
  },
  {
    title: "Your room and bed",
    body: "- Use only your own room and bed.\n- Ask the front desk to change rooms or beds.\n- Do not go into another tenant's room without asking.\n- Do not let anyone else sleep in your bed.",
  },
  {
    title: "No smoking or vaping inside",
    body: "- No smoking or vaping anywhere in the building: rooms, bathrooms, halls or stairs.",
  },
  {
    title: "Fire safety",
    body: "- Keep halls, stairs and exits clear.\n- No candles or open flames in rooms.\n- Do not touch smoke alarms or fire extinguishers.\n- Smell smoke or burning? Tell staff right away.",
  },
  {
    title: "Keep it clean",
    body: "- Keep your room and bathroom clean.\n- Put trash in the right bin.\n- Do not leave things in the halls.\n- Do not throw anything out of the window.",
  },
  {
    title: "Shared kitchen",
    body: "- Use the kitchen at your times, shown in the app.\n- Do not leave cooking alone.\n- Clean up and switch everything off after.\n- Put your name and room number on food you keep there.",
  },
  {
    title: "Laundry",
    body: "- Bring your laundry bag to the front desk.\n- Take money and valuables out first.\n- Your bag gets a number. Follow it in the app.\n- Hang clothes only in the drying area.",
  },
  {
    title: "Keys and cards",
    body: "- Keep your key or card safe. Do not lend it.\n- Do not share your app password.\n- Lock your room when you go out.\n- Lost your key or card? Tell the front desk right away.",
  },
  {
    title: "Take care of the room",
    body: "- Do not drill, paint or fix things yourself.\n- Something broken or leaking? Report it in the app.\n- Only toilet paper goes in the toilet.",
  },
  {
    title: "Repairs and cleaning",
    body: "- Staff knock and say who they are before coming in.\n- Not sure who someone is? Ask the front desk first.",
  },
  {
    title: "Urgent problems",
    body: "- For a leak, no power, or anything unsafe, go to the front desk right away.\n- For other problems, use the app.",
  },
  {
    title: "Moving out",
    body: "- Tell the front desk your move-out date.\n- Take all your things and trash.\n- Return your keys and cards.",
  },
].map((rule, index) => ({ ...rule, position: index + 1 }));
