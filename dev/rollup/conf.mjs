import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";


export default {
	"input": "node_modules/auto-launch/dist/index.js",
	"output": {
		"file": "auto-launch.js",
		"format": "cjs"
	},
	"plugins": [nodeResolve(), commonjs()]
};