#!/usr/bin/env node

import { promises as fs } from 'fs';
import sizeOf from 'image-size';
import { sanitize, allFiles, lowerCamelize } from './utils';
import { resolve, relative, dirname, extname, basename } from 'path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { Tree, generateTree } from './tree';
import pack from 'bin-pack';
import { createCanvas, loadImage } from 'canvas';

type Rectangle = {x: number, y: number, width: number, height: number};
type SpritesheetResult = Map<string, Rectangle>;

function importName(assetDir: string, png: string): string {
    let importName = png;
    importName = resolve(png);

    const prefix = resolve(assetDir);
    const prefixIndex = importName.indexOf(prefix);
    if (prefixIndex >= 0) {
        importName = importName.slice(prefixIndex + prefix.length);
    }

    importName = sanitize(importName);
    return importName;
}

function generatedTemplateInterface(tree: Tree, name: string, indent: string = ''): string {
    let generated = '{\n';
    for (const [subname, item] of tree.entries()) {
        if (item instanceof Map) {
            const generatedSub = generatedTemplateInterface(item, subname, indent + '    ');
            generated += indent + `    ${lowerCamelize(subname)}: ${generatedSub}`;
        } else {
            const withoutExt = basename(subname, extname(subname));
            generated += indent + `    ${lowerCamelize(withoutExt)}: T,\n`;
        }
    }
    generated += indent + '}\n';
    return generated;
}

async function generatedCreateCatalogFunction(assetDir: string, tree: Tree, spritesheet: SpritesheetResult | null): Promise<string> {
    async function rec(tree: Tree, indent: string = '') {
        let generated = '{\n';
        for (const [subname, item] of tree.entries()) {
            if (item instanceof Map) {
                const generatedSub = await rec(item, indent + '    ');
                generated += indent + `    ${lowerCamelize(subname)}: ${generatedSub},\n`;
            } else {
                const dimensions = sizeOf(item);
                const stats = await fs.stat(item);
                const withoutExt = basename(subname, extname(subname));
                const spriteData = spritesheet?.get(resolve(item)) || null;
                let spriteDataArr: string | null = null;
                if (spriteData)  {
                    spriteDataArr = `expandSpriteData(SpriteSheetPng, ${spriteData.x}, ${spriteData.y}, ${spriteData.width}, ${spriteData.height})`;
                }

                generated += indent + `    ${lowerCamelize(withoutExt)}: createItem(expand(
                    ${importName(assetDir, item)},
                    ${dimensions.width},
                    ${dimensions.height},
                    ${stats.size},
                    ${spriteData ? spriteDataArr : ''}
                )),\n`;
            }
        }
        generated += indent + '}';
        return generated;
    }

    let generated = '\n';
    generated += 'export function createTextureCatalog<T>(createItem: (opts: CreateItemOptions) => T): TextureCatalog<T> {\n';
    generated += `    return ${await rec(tree, '   ')};\n`;
    generated += '}\n';
    return generated;
}

function generateExpandFunction() {
    let generated = '\n';
    generated += 'function expandSpriteData(sheet: string, x: number, y: number, width: number, height: number): SpriteData {\n';
    generated += `    return { sheet, frame: { x, y, width, height } };\n`;
    generated += '}\n\n';
    generated += 'function expand(path: string, width: number, height: number, size: number, spriteData: SpriteData): CreateItemOptions {\n';
    generated += `    return { path, width, height, size, spriteData };\n`;
    generated += '}\n';
    return generated;
}

async function createSpritesheet(tree: Tree, outFile: string, excludes: string[]): Promise<SpritesheetResult> {
    const bins: (pack.Bin & {path: string})[] = [];

    const padding = 1;

    function generateBins(tree: Tree) {
        itemLoop: for (const item of tree.values()) {
            if (item instanceof Map) {
                generateBins(item);
            } else {
                for (const exclude of excludes) {
                    if (item.includes(exclude)) {
                        continue itemLoop;
                    }
                }

                const dimensions = sizeOf(item);
                bins.push({
                    width: dimensions.width! + padding * 2,
                    height: dimensions.height! + padding * 2,
                    path: resolve(item),
                });
            }
        }
    }

    generateBins(tree);

    const packed = pack(bins);

    const canvas = createCanvas(packed.width, packed.height);
    const ctx = canvas.getContext('2d');

    for (const item of packed.items) {
        const image = await loadImage(item.item.path);
        ctx.drawImage(image, item.x + padding, item.y + padding);
    }

    const buffer = canvas.toBuffer("image/png");
    await fs.writeFile(outFile, buffer);

    const resultMap = new Map<string, {x: number, y: number, width: number, height: number}>();
    for (const item of packed.items) {
        resultMap.set(item.item.path, {
            x: item.x + padding,
            y: item.y + padding,
            width: item.width - padding * 2,
            height: item.height - padding * 2,
        });
    }
    return resultMap;
}

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .options({
            'outFile': {
                type: 'string',
                default: 'textures.ts',
                alias: 'o',
                describe: 'Directory to generate the files into',
            },
            'assetDir': {
                type: 'string',
                default: '.',
                alias: 'a',
                describe: 'Asset directory where all the PNGs are located',
            },
            'outSpritesheet': {
                type: 'string',
                required: false,
                alias: 's',
                describe: 'Path to the generated spritesheet',
            },
            'spritesheetExclude': {
                type: 'string',
                array: true,
                required: false,
                alias: 'x',
                describe: 'Exclude certain paths from the spritesheet',
            },
        })
        .argv;

    const texturesRoot = argv.assetDir;
    const generatedTs = argv.outFile;
    try {
        await fs.rm(generatedTs, { 'recursive': true });
    } catch (e) {}

    const files = await allFiles(texturesRoot);
    const pngs = files.filter(file => extname(file) === '.png');

    const imports = [];
    const tree = await generateTree(argv.assetDir, pngs);

    for (const png of pngs) {
        const importPath = relative(dirname(argv.outFile), png).replace(/\\/g, '/');
        imports.push(`import ${importName(argv.assetDir, png)} from './${importPath}';`);
    }

    let spritesheet: SpritesheetResult | null = null;
    if (argv.outSpritesheet) {
        spritesheet = await createSpritesheet(tree, argv.outSpritesheet, argv.spritesheetExclude || []);

        const importPath = relative(dirname(argv.outFile), resolve(argv.outSpritesheet)).replace(/\\/g, '/');
        imports.push(`import SpriteSheetPng from './${importPath}';`);
    }

    let generatedFileContent = '';
    generatedFileContent += imports.join('\n');
    generatedFileContent += '\n\n';
    generatedFileContent += `export interface Rectangle {
        x: number;
        y: number;
        width: number;
        height: number;
    }\n\n`;
    generatedFileContent += `export interface SpriteData {
        sheet: string;
        frame: Rectangle;
    }\n\n`;
    generatedFileContent += `export interface CreateItemOptions {
        path: string;
        width: number;
        height: number;
        size: number;
        spriteData: SpriteData | null;   
    }\n\n`;
    generatedFileContent += 'export type TextureCatalog<T> = ' + generatedTemplateInterface(tree, 'TextureCatalog');
    generatedFileContent += '\n\n';
    generatedFileContent += generateExpandFunction();
    generatedFileContent += await generatedCreateCatalogFunction(argv.assetDir, tree, spritesheet);

    await fs.writeFile(generatedTs, generatedFileContent);
}

main();
