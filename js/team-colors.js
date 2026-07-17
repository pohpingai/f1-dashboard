// Real-world team colors, keyed by the constructor name as it appears in
// Jolpica-F1 data. Used to tint standings entries and the winner hero's
// accent bar - team colors are how F1 fans visually parse this stuff.
const TEAM_COLORS = {
  "Ferrari": "#DC0000",
  "Mercedes": "#00D2BE",
  "Red Bull": "#3671C6",
  "McLaren": "#FF8700",
  "Aston Martin": "#229971",
  "Alpine F1 Team": "#2293D1",
  "Williams": "#64C4FF",
  "RB F1 Team": "#6692FF",
  "Haas F1 Team": "#B6BABD",
  "Audi": "#BB0A30",
  "Cadillac F1 Team": "#B38B59",
};

const DEFAULT_TEAM_COLOR = "#888888";

function teamColor(constructorName) {
  return TEAM_COLORS[constructorName] || DEFAULT_TEAM_COLOR;
}
