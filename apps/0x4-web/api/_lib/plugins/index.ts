/**
 * Plugin registry bootstrap — register all built-in plugins here.
 * To add a capability: create a plugin file, import it, register it. Done.
 */
import { registry } from '../plugin.js';
import { monadTradingPlugin } from './monadTrading.js';
import { mediaPlugin } from './media.js';
import { codeRunnerPlugin } from './codeRunner.js';

registry.register(monadTradingPlugin);
registry.register(mediaPlugin);
registry.register(codeRunnerPlugin);

export { registry };
