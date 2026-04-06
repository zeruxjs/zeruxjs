export default ({ params, services, state }: any) => {
  const formatSlug = services.composables.formatSlug;
  const title = typeof formatSlug === "function" ? formatSlug(params.slug) : params.slug;

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}</title>
      <style>
        body { margin: 0; font-family: Georgia, serif; background: #f7f2ea; color: #231f1a; }
        article { max-width: 760px; margin: 0 auto; padding: 42px 22px 56px; }
        .eyebrow { text-transform: uppercase; letter-spacing: .14em; font-size: 12px; color: #b45309; }
        h1 { margin: 12px 0 18px; font-size: clamp(2.4rem, 6vw, 4.3rem); line-height: .96; }
        p { line-height: 1.85; color: #5f5547; }
        code { background: rgba(35,31,26,.08); padding: 3px 8px; border-radius: 999px; }
      </style>
    </head>
    <body>
      <article>
        <div class="eyebrow">Dynamic Route</div>
        <h1>${title}</h1>
        <p>
          The slug <code>${params.slug}</code> came from the route matcher. Middleware also attached
          request state, so the request id for this page is <code>${state.requestId}</code>.
        </p>
      </article>
    </body>
  </html>`;
};
