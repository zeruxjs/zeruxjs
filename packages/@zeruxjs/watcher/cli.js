import { cli } from "@zerux/cli";

cli.addCommand("zerux", "serve", async () => {
    cli.success("Server started");
});