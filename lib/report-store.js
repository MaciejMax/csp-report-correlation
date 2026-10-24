const fs = require("node:fs");
const path = require("node:path");

function createReportStore(file, limit = 200) {
  function load() {
    try {
      const entries = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!Array.isArray(entries)) throw new Error("The report store must contain an array.");
      return entries;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  function write(entries) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(entries, null, 2) + "\n");
  }

  return {
    load,
    save(entry) { write([entry, ...load()].slice(0, limit)); },
    clear() { write([]); },
  };
}

module.exports = { createReportStore };
