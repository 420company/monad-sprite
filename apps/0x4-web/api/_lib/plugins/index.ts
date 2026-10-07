/**
 * Plugin registry bootstrap — register all built-in plugins here.
 * To add a capability: create a plugin file, import it, register it. Done.
 */
import { registry } from '../plugin.js';
import { monadTradingPlugin } from './monadTrading.js';
import { mediaPlugin } from './media.js';
import { codeRunnerPlugin } from './codeRunner.js';
import { videoPlugin } from './video.js';
import { voicePlugin } from './voice.js';
import { webPlugin } from './web.js';
import { filesPlugin } from './files.js';
import { memoryPlugin } from './memory.js';

registry.register(monadTradingPlugin);
registry.register(mediaPlugin);
registry.register(codeRunnerPlugin);
registry.register(videoPlugin);
registry.register(voicePlugin);
registry.register(webPlugin);
registry.register(filesPlugin);
registry.register(memoryPlugin);

export { registry };
