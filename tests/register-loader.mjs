// Đăng ký tests/loader.mjs làm resolve hook cho node --experimental-strip-types
import { register } from "node:module";

register("./loader.mjs", import.meta.url);
