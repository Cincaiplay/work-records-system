import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// project root = src/config/../../
dotenv.config({
  path: path.join(__dirname, "../../.env"),
  override: true,
});
