import {
  createMetadataHooks,
  resolveMetadata,
  renderMetadata,
} from "@zeruxjs/seo/composition";

const hooks = createMetadataHooks(); // One application/request owner; never cross-tenant globals.
hooks.register("metadata:resolve", (_context, metadata) => ({
  ...metadata,
  openGraph: { ...metadata.openGraph, siteName: "Example Docs" },
}));
try {
  const metadata = await resolveMetadata(
    {
      publicBase: "https://example.com/docs/",
      locales: {
        "en-US": "https://example.com/docs/en/",
        fr: "https://example.com/docs/fr/",
      },
    },
    [
      {
        title: { template: "%s | Example" },
        robots: { index: true, follow: true },
      },
      {
        title: "Guide",
        description: "An authored guide",
        alternates: { fr: "https://example.com/docs/fr/guide" },
        jsonLd: [
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: "Guide",
          },
        ],
      },
    ],
    {
      url: "https://example.com/docs/en/guide",
      locale: "en-US",
      visibility: "public",
    },
    { hooks },
  );
  // An authored renderer can consume metadataElements(metadata), or this safe HTML sink.
  console.log(renderMetadata(metadata));
} finally {
  hooks.dispose();
  await hooks.whenIdle();
}
