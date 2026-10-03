const required = ["DATABASE_URL"];
if (process.env.MOCK_MODE !== "true") required.push("MODAL_API_URL", "MODAL_WEB_SECRET");
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("Environment looks good.");
