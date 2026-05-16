import * as esbuild from "esbuild";
import tailwindPlugin from "esbuild-plugin-tailwindcss";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

function createBaseConfig(): esbuild.BuildOptions {
	return {
		bundle: true,
		minify: production,
		sourcemap: production ? false : "inline",
		sourcesContent: !production,
		logLevel: "info",
		loader: {
			".ttf": "file",
		},
	};
}

function createProblemMatcherPlugin(entryPoints: string[]): esbuild.Plugin {
	return {
		name: "problem-matcher",
		setup(build) {
			build.onStart(() => {
				console.log(`[watch] build started: ${entryPoints.join(", ")}`);
			});
			build.onEnd((result) => {
				if (result.errors.length === 0) {
					console.log(`[watch] build finished: ${entryPoints.join(", ")}`);
				}
			});
		},
	};
}

async function main() {
	const baseConfig = createBaseConfig();

	const buildmap = {
		extension: esbuild.context({
			...baseConfig,
			entryPoints: ["src/extension.ts"],
			outdir: "dist/",
			format: "cjs",
			platform: "node",
			external: ["vscode"],
			plugins: [createProblemMatcherPlugin(["src/extension.ts"])],
		}),
		webview: esbuild.context({
			...baseConfig,
			entryPoints: ["src/frontend/main.tsx"],
			outdir: "dist/client/",
			format: "esm",
			sourcemap: production ? false : "inline",
			sourcesContent: true,
			external: ["vscode-webview"],
			jsx: "automatic",
			plugins: [createProblemMatcherPlugin(["src/frontend/main.tsx"]), tailwindPlugin()],
		}),
	};

	if (watch) {
		const contexts = await Promise.all(Object.values(buildmap));
		try {
			await Promise.all(contexts.map((context) => context.rebuild()));
		} catch {
			console.error("Initial build failed. Watching for changes...");
		}

		await Promise.all(contexts.map((context) => context.watch()));

		process.on("SIGINT", async () => {
			await Promise.all(contexts.map((context) => context.dispose()));
			process.exit(0);
		});
	} else {
		await Promise.all(
			Object.values(buildmap).map((build) =>
				build.then(async (context: esbuild.BuildContext) => {
					await context.rebuild();
					await context.dispose();
				}),
			),
		);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
