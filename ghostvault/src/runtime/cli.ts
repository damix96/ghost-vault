#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RuntimeCommand } from './command.js';
import { RuntimeOptions } from './settings.js';

export class RuntimeCli {
  public static run = async (args = process.argv.slice(2), defaults: RuntimeOptions = {}): Promise<void> => {
    const command = new RuntimeCommand({
      createRuntime: async settings => (await import('./application.js')).RuntimeApplication.create(settings),
      startBridge: async settings => { await new (await import('./bridge.js')).RuntimeBridge(settings).start(); },
    });
    await command.run(args, defaults);
  };
  public static main = (args = process.argv.slice(2), defaults: RuntimeOptions = {}): void => {
    void RuntimeCli.run(args, defaults).catch(error => { console.error((error as Error).message); process.exitCode = 1; });
  };
  public static isMain = (url: string): boolean => Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === url;
}

if (RuntimeCli.isMain(import.meta.url)) RuntimeCli.main();
