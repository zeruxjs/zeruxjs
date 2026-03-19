#!/usr/bin/env node

import cli from "../index.js";

cli.addKey("zerux", {
    description: "Zerux JS CLI - A powerful helper for node applications",
    func: () => {
        cli.addCommand('zerux', 'meow', () => {
            console.log('called meow');
        }, {
            description: "A simple meow command for testing registration",
            help: [
                { arg: "--volume", "its description": "Adjust the meow volume" }
            ],
            docs: "Detailed documentation for the meow command. It shows how the registration system works.",
            example: "npx zerux meow"
        });

        cli.addCommand('zerux', 'apple', () => {
            console.log('called apple 1');
        }, "Show apple information");
    }
});
// here will add cli.addCommand if want in future