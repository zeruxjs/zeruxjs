import path from "node:path";
export function loadSettings(environment = process.env) {
  const {
    ZENIX_ORIGIN: origin,
    ZENIX_DATABASE: filename,
    ZENIX_TENANT: tenant,
    ZENIX_SITE: site,
  } = environment;
  if (
    typeof origin !== "string" ||
    typeof filename !== "string" ||
    !path.isAbsolute(filename) ||
    filename.includes("\0") ||
    !/^https?:\/\//.test(origin)
  )
    throw Error(
      "ZENIX_SETTINGS_REQUIRED: exact origin, absolute SQLite filename, tenant and site are required",
    );
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    ![tenant, site].every(
      (value) =>
        typeof value === "string" &&
        /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value),
    )
  )
    throw Error("ZENIX_SETTINGS_INVALID");
  return {
    filename,
    origin,
    scope: { tenant, site },
    basePath: "/cms",
    entryId: "home",
  };
}
