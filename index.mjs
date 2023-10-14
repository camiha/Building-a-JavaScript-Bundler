import fs from "node:fs";
import { cpus } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import yargs from "yargs";
import chalk from "chalk";

import JestHasteMap from "jest-haste-map";
import Resolver from "jest-resolve";

const root = join(dirname(fileURLToPath(import.meta.url)), "product");

const hasteMapOptions = {
	extensions: ["js"],
	maxWorkers: cpus().length,
	name: "bundler",
	platforms: [],
	rootDir: root,
	roots: [root],
	retainAllFiles: true,
};

const hasteMap = new JestHasteMap.default(hasteMapOptions);
await hasteMap.setupCachePath(hasteMapOptions);
const { hasteFS, moduleMap } = await hasteMap.build();

const options = yargs(process.argv).argv;
const entryPoint = resolve(process.cwd(), options.entryPoint);

if (!hasteFS.exists(entryPoint)) {
	throw new Error(
		"`--entry-point` does not exist. Please provide a path to a valid file.",
	);
}

console.log(chalk.bold(`❯ Building ${chalk.blue(options.entryPoint)}`));

const resolver = new Resolver.default(moduleMap, {
	extensions: [".js"],
	hasCoreModules: false,
	rootDir: root,
});

const seen = new Set();
const modules = new Map();
const queue = [entryPoint];
while (queue.length) {
	const module = queue.shift();

	if (seen.has(module)) {
		continue;
	}
	seen.add(module);

	// 各依存関係を解決し、名前に基づいて格納する
	const dependencyMap = new Map(
		hasteFS
			.getDependencies(module)
			.map((dependencyName) => [
				dependencyName,
				resolver.resolveModule(module, dependencyName),
			]),
	);

	const code = fs.readFileSync(module, "utf8");
	// `module.exports =` 以降のコードを取得
	const moduleBody = code.match(/module\.exports\s+=\s+(.*?);/)?.[1] || "";

	const metadata = {
		code: moduleBody || code,
		dependencyMap,
	};
	modules.set(module, metadata);
	queue.push(...dependencyMap.values());
}

console.log(chalk.bold(`❯ Found ${chalk.blue(seen.size)} files`));
console.log(chalk.bold("❯ Serializing bundle"));

// エントリーポイントを最後に処理するため、逆方向に各モジュールを処理
for (const [module, metadata] of Array.from(modules).reverse()) {
	let { code } = metadata;
	for (const [dependencyName, dependencyPath] of metadata.dependencyMap) {
		// 依存関係のモジュール本体を、それを必要とするモジュールにインライン化
		code = code.replace(
			new RegExp(
				// .` と `/` をエスケープ
				`require\\(('|")${dependencyName.replace(/[\/.]/g, "\\$&")}\\1\\)`,
			),
			modules.get(dependencyPath).code,
		);
	}
	metadata.code = code;
}

console.log(modules.get(entryPoint).code.replace(/' \+ '/g, ""));
