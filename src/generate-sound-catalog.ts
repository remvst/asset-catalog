#!/usr/bin/env node

import { promises as fs } from 'fs';
import { sanitize, allFiles, categoryPath } from './utils';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { dirname, extname, basename, relative, parse } from 'path';
import audiosprite from 'audiosprite';

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .options({
            'outFile': {
                type: 'string',
                default: '.',
                alias: 'o',
                describe: 'Directory to generate the files into',
            },
            'assetDir': {
                type: 'string',
                default: '.',
                alias: 'a',
                describe: 'Asset directory where all the PNGs are located',
            },
            'wav': {
                type: 'boolean',
                default: false,
                describe: 'Include .wav files',
            },
            'ogg': {
                type: 'boolean',
                default: true,
                describe: 'Include .ogg files',
            },
            'mp3': {
                type: 'boolean',
                default: true,
                describe: 'Include .mp3 files',
            },
            'outSpritesheet': {
                type: 'string',
                required: false,
                describe: 'Path to the exported spritesheet (without the extension)',
            },
            'spritesheetExcludeCategory': {
                type: 'string',
                array: true,
                required: false,
                alias: 'x',
                default: [] as string[],
                describe: 'Exclude certain categories from the spritesheet',
            },
        })
        .argv;

    const extensions: string[] = [];
    if (argv.mp3) extensions.push('.mp3');
    if (argv.ogg) extensions.push('.ogg');
    if (argv.wav) extensions.push('.wav');

    const generatedTs = argv.outFile;
    try {
        await fs.rm(generatedTs, { 'recursive': true });
    } catch (e) {}


    const files = await allFiles(argv.assetDir);
    const sounds = files.filter(file => extensions.indexOf(extname(file)) >= 0)
        .filter(file => basename(file, extname(file)) !== 'sprites');

    const defs = new Map<string, Map<string, Set<string>>>();

    for (const sound of sounds) {
        const category = categoryPath(argv.assetDir, sound).join('_');
        const ext = extname(sound);
        const filenameWithoutExt = basename(sound, ext);

        if (!defs.has(category)) {
            defs.set(category, new Map());
        }

        if (!defs.get(category)!.has(filenameWithoutExt)) {
            defs.get(category)!.set(filenameWithoutExt, new Set());
        }

        defs.get(category)!.get(filenameWithoutExt)!.add(sound);
    }

    const spriteSounds: Map<string, string> = new Map();

    let spritesheetJson: any = null;
    if (argv.outSpritesheet) {
        for (const category of defs.keys()) {
            let isCategoryExcluded = false;
            for (const exclusion of argv.spritesheetExcludeCategory) {
                if (category.indexOf(exclusion) !== -1) {
                    isCategoryExcluded = true;
                    break;
                }
            }
            if (isCategoryExcluded) {
                continue;
            }

            for (const filenameWithoutExt of defs.get(category)!.keys()) {
                const fileSet = defs.get(category)!.get(filenameWithoutExt)!;

                const files = Array.from(fileSet);
                const pickedFile = files.find(file => extname(file) === '.wav') ||
                    files.find(file => extname(file) === '.ogg') ||
                    files.find(file => extname(file) === '.mp3');
                if (!pickedFile) {
                    throw new Error('Unable to pick file for sprite in ' + category);
                }
                spriteSounds.set(category + '/' + filenameWithoutExt, pickedFile);
            }
        }

        spritesheetJson = await new Promise((resolve, reject) => {
            const options: audiosprite.Option = {
                output: argv.outSpritesheet,
                format: 'howler',
                export: extensions.map(ext => ext.slice(1)).join(','),
            };

            audiosprite(Array.from(spriteSounds.values()), options, (err, res) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(res);
                }
            });
        });
    }

    const imports = [];
    const definitions = [];
    const funcs = [];

    let soundDefinition = '';
    soundDefinition += 'export class SoundDefinition {\n';
    soundDefinition += '    constructor(\n';
    soundDefinition += '        readonly basename: string,\n';
    soundDefinition += '        readonly files: string[],\n';
    soundDefinition += '        readonly sprite: string | null,\n';
    soundDefinition += '        readonly averageFileSize: number,\n';
    soundDefinition += '    ) {}\n';
    soundDefinition += '}\n';
    definitions.push(soundDefinition);

    if (argv.outSpritesheet) {
        const modifiedSpritesheetJson = { ...spritesheetJson };
        modifiedSpritesheetJson.urls = extensions.map(ext => argv.outSpritesheet + ext);

        let spriteSheetFunc = 'export function sound_spritesheet() {\n';
        spriteSheetFunc += '    return {\n';
        spriteSheetFunc += '        urls: [\n';


        const idealOrder = ['.ogg', '.mp3', '.wav'];
        const sortedExtensions = extensions.sort((a, b) => idealOrder.indexOf(a) - idealOrder.indexOf(b));
        for (const extension of sortedExtensions) {
            const importName = 'sprites_' + extension.slice(1);
            imports.push(`import ${importName} from '${relative(dirname(argv.outFile), argv.outSpritesheet + extension).replace(/\\/g, '/')}';`);

            spriteSheetFunc += `            ${importName},\n`;
        }

        let totalFileSize = 0;
        for (const extension of sortedExtensions) {
            const soundFile = argv.outSpritesheet + extension;
            const stats = await fs.stat(soundFile);
            totalFileSize += stats.size;
        }

        const averageFileSize = Math.round(totalFileSize / files.length);

        spriteSheetFunc += '        ],\n';
        spriteSheetFunc += `        sprite: ${JSON.stringify(spritesheetJson.sprite)},\n`;
        spriteSheetFunc += `        averageFileSize: ${averageFileSize},\n`;
        spriteSheetFunc += '    }\n';
        spriteSheetFunc += '};\n';
        funcs.push(spriteSheetFunc);
    }

    for (const category of defs.keys()) {
        let func = `export function sound_${category}(): SoundDefinition[] {\n`;
        func += `   return [\n`;

        for (const filenameWithoutExt of defs.get(category)!.keys()) {
            func += `        new SoundDefinition(\n`;
            func += `            '${filenameWithoutExt}',\n`;
            func += '            [\n';

            const files = Array.from(defs.get(category)!.get(filenameWithoutExt)!);
            const idealOrder = ['.ogg', '.mp3', '.wav'];
            files.sort((a, b) => {
                return idealOrder.indexOf(extname(a)) - idealOrder.indexOf(extname(b));
            });

            let totalFileSize = 0;
            for (const soundFile of files) {
                const importName = sanitize(soundFile);
                imports.push(`import ${importName} from '${relative(dirname(argv.outFile), soundFile).replace(/\\/g, '/')}';`);
                func += `                ${importName},\n`;
                const stats = await fs.stat(soundFile);
                totalFileSize += stats.size;
            }

            const averageFileSize = Math.round(totalFileSize / files.length);

            const hasSprite = spriteSounds.get(category + '/' + filenameWithoutExt)!;

            func += '            ],\n';
            func += `            ${JSON.stringify(hasSprite ? filenameWithoutExt : null)},\n`;
            func += `            ${averageFileSize},\n`;
            func += '        ),\n';
        }

        func += `   ];\n`;
        func += `}`;

        funcs.push(func);
    }

    let generatedFileContent = '';
    generatedFileContent += imports.join('\n');
    generatedFileContent += '\n\n';
    generatedFileContent += definitions.join('\n\n');
    generatedFileContent += '\n\n';
    generatedFileContent += funcs.join('\n\n');
    generatedFileContent += '\n';

    await fs.writeFile(generatedTs, generatedFileContent);
}

main();
