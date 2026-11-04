import {
  createShortLinkService,
  type ShortLinkStore,
  type ShortLinkOptions,
} from "@zeruxjs/share/server";

// Host implements atomic durable reservation/CAS and verifies fresh session permissions.
export function configureLinks(
  store: ShortLinkStore,
  authorize: ShortLinkOptions["authorize"],
) {
  return createShortLinkService({
    origin: "https://sho.example.com",
    prefix: "/s/",
    store,
    authorize,
    allowedOrigins: ["https://www.example.com"],
    allowDestination: (destination) =>
      !new URL(destination).searchParams.has("next"),
    reservedPaths: ["/s/manage"],
    defaultTtlMs: 7 * 86400000,
  });
}
// const links=configureLinks(hostStore,hostSessionAuthorizer);
// const link=await links.create(verifiedRequestContext,{
//   destination:'https://www.example.com/guide', // random 144-bit slug, 302, seven-day expiry
// });
// Host mounts links.handler at links.route; management APIs are not mounted automatically.
// await links.close() before closing hostStore. Redirects do not grant destination permissions.
