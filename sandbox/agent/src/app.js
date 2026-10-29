import express from 'express';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { Server } from "socket.io";
import http from 'http';
import pty from 'node-pty';
import os from 'os';
import cors from 'cors';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';


const WORKING_DIR = '/workspace';
const execFileAsync = promisify(execFile);
const BUILD_OUTPUT_DIR = '/tmp/flowent-validation';

let lastValidation = {
    status: 'idle',
    message: 'Project validation has not run yet.',
    details: '',
    checkedAt: null,
};
let validationQueue = Promise.resolve();

const cleanCommandOutput = (value) => String(value ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .trim()
    .slice(-12000);

const runProjectValidation = async () => {
    lastValidation = {
        status: 'running',
        message: 'Validating the project build...',
        details: '',
        checkedAt: new Date().toISOString(),
    };

    try {
        const { stdout, stderr } = await execFileAsync(
            'npm',
            [ 'run', 'build', '--', '--outDir', BUILD_OUTPUT_DIR, '--emptyOutDir' ],
            {
                cwd: WORKING_DIR,
                env: process.env,
                timeout: 120000,
                maxBuffer: 10 * 1024 * 1024,
            }
        );

        lastValidation = {
            status: 'passed',
            message: 'Project build passed.',
            details: cleanCommandOutput(stderr || stdout),
            checkedAt: new Date().toISOString(),
        };
    } catch (error) {
        lastValidation = {
            status: 'failed',
            message: 'Project build failed. Fix the reported error and validate again.',
            details: cleanCommandOutput(error.stderr || error.stdout || error.message),
            checkedAt: new Date().toISOString(),
        };
    }

    return lastValidation;
};

const queueProjectValidation = () => {
    const nextValidation = validationQueue.then(runProjectValidation, runProjectValidation);
    validationQueue = nextValidation.then(() => undefined, () => undefined);
    return nextValidation;
};

const installProjectDependencies = async () => {
    const { stdout, stderr } = await execFileAsync(
        'npm',
        [ 'install', '--no-audit', '--no-fund' ],
        {
            cwd: WORKING_DIR,
            env: process.env,
            timeout: 180000,
            maxBuffer: 10 * 1024 * 1024,
        }
    );

    return cleanCommandOutput(stderr || stdout);
};

const app = express();
const httpServer = http.createServer(app);

app.use(morgan('dev'));
app.use(cors({
    methods: [ "GET", "POST", "PATCH", "DELETE" ],
    origin: "*",
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: [ "GET", "POST", "PATCH" ],
    }
});


app.get('/', (req, res) => {
    res.status(200).json({
        message: 'Hello from sandbox agent!',
        status: 'success',
    });
});

app.get('/project-status', (req, res) => {
    res.status(200).json(lastValidation);
});

app.post('/validate-project', async (req, res) => {
    const validation = await queueProjectValidation();
    res.status(200).json(validation);
});



const shell = process.env.SHELL || '/bin/bash';
const shellArgs = shell.endsWith('bash') ? [ '--noprofile', '--norc', '-i' ] : [];

// Spawn the PTY process
const ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: "/workspace",
    env: {
        ...process.env,
        TERM: 'xterm-256color',
        PS1: 'flowent@workspace:\\w$ '
    }
});

ptyProcess.onData((data) => {
    io.emit('terminal-output', data);
});

ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`PTY process exited with code: ${exitCode}, signal: ${signal}`);
});

io.on("connection", (socket) => {
    console.log("Client connected: " + socket.id);

    let currentDirectory = WORKING_DIR;
    try {
        currentDirectory = fs.readlinkSync(`/proc/${ptyProcess.pid}/cwd`);
    } catch {
        // The shell may be between processes; /workspace remains accurate initially.
    }
    socket.emit('terminal-output', `\r\n\x1b[38;5;214mflowent@workspace\x1b[0m:\x1b[38;5;75m${currentDirectory}\x1b[0m$ `);

    socket.on("terminal-input", (data) => {
        ptyProcess.write(data);
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected: " + socket.id);
    });
})

/**
 * @route GET /list-files
 * @description Lists all files in the working directory and its subdirectories. Returns a JSON object with the file paths relative to the working directory. exclude directories like node_modules, .git,dist, etc.
 * - eg. {
 *     "files": [
 *         "file1.txt",
 *         "src/file2.txt",
 *         "src/subdir/file3.txt"
 *     ]
 * }
 */
app.get("/list-files", async (req, res) => {

    const listFiles = async (dir, baseDir) => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        const files = [];

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(baseDir, fullPath);

            // Exclude certain directories
            if (entry.isDirectory() && [ 'node_modules', '.git', 'dist' ].includes(entry.name)) {
                continue;
            }

            if (entry.isDirectory()) {
                files.push(...await listFiles(fullPath, baseDir));
            } else {
                files.push(relativePath);
            }
        }

        return files;
    }

    try {
        const files = await listFiles(WORKING_DIR, WORKING_DIR);
        res.status(200).json({
            message: 'Files listed successfully',
            files,
        });
    } catch (err) {
        res.status(500).json({
            message: `Error listing files: ${err.message}`,
            status: 'error',
        });
    }

})


/**
 * @route GET /read-files
 * @description Reads the content of all files requested in the query parameter 'files' and returns their content as a JSON object.
 * - eg. /read-files?files=file1.txt,/src/file2.txt
 */
app.get("/read-files", async (req, res) => {

    const files = req.query.files;

    if (!files) {
        return res.status(400).json({
            message: 'No files specified in query parameter',
            status: 'error',
        });
    }

    const fileList = files.split(',');

    const results = await Promise.all(fileList.map(async (file) => {
        const filePath = path.join(WORKING_DIR, file);
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            return {
                [ filePath.replace(WORKING_DIR, '') ]: content,
            }
        } catch (err) {
            return {
                [ filePath.replace(WORKING_DIR, '') ]: `Error reading file: ${err.message}`,
            }
        }
    }));

    res.status(200).json({
        message: 'File contents',
        files: results,
    });

})


/**
 * @route PATCH /update-files
 * @description Updates the content of files specified in the request body. The request body should container a property 'updates' with a JSON Array of object, each object should have a 'file' property specifying the file path (relative to the working directory) and a 'content' property specifying the new content for the file.
 */
app.patch("/update-files", async (req, res) => {

    const updates = req.body.updates;

    if (!updates || !Array.isArray(updates)) {
        return res.status(400).json({
            message: 'Invalid request body. Expected a JSON object with an "updates" property containing an array of file updates.',
            status: 'error',
        });
    }

    const results = await Promise.all(updates.map(async (update) => {
        const { file, content } = update;
        const filePath = path.join(WORKING_DIR, file);
        try {

            console.log(path.dirname(filePath), filePath);

            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            await fs.promises.writeFile(filePath, content, 'utf-8');
            return {
                [ filePath ]: 'File updated successfully',
            }
        } catch (err) {
            return {
                [ filePath ]: `Error updating file: ${err.message}`,
            }
        }
    }));

    const updatedFiles = updates.map(update =>
        path.relative(WORKING_DIR, path.join(WORKING_DIR, update.file))
    );
    const dependencyFilesChanged = updatedFiles.some(file =>
        file === 'package.json' || file === 'package-lock.json'
    );

    let dependencyInstall = null;
    if (dependencyFilesChanged) {
        try {
            dependencyInstall = {
                status: 'passed',
                details: await installProjectDependencies(),
            };
        } catch (error) {
            dependencyInstall = {
                status: 'failed',
                details: cleanCommandOutput(error.stderr || error.stdout || error.message),
            };
            lastValidation = {
                status: 'failed',
                message: 'Dependency installation failed.',
                details: dependencyInstall.details,
                checkedAt: new Date().toISOString(),
            };
        }
    }

    const validation = dependencyInstall?.status === 'failed'
        ? lastValidation
        : await queueProjectValidation();

    res.status(200).json({
        message: 'File update results',
        results,
        dependencyInstall,
        validation,
    });
})


/**
 * @route POST /create-files
 * @description Creates new files with the content specified in the request body. The request body should contain a property 'files' with a JSON Array of objects, each object should have a 'file' property specifying the file path (relative to the working directory) and a 'content' property specifying the content for the new file.
 */
app.post("/create-files", async (req, res) => {
    const files = req.body.files;

    if (!files || !Array.isArray(files)) {
        return res.status(400).json({
            message: 'Invalid request body. Expected a JSON object with a "files" property containing an array of file objects.',
            status: 'error',
        });
    }

    const results = await Promise.all(files.map(async (fileObj) => {
        const { file, content } = fileObj;
        const filePath = path.join(WORKING_DIR, file);
        try {

            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            await fs.promises.writeFile(filePath, content, 'utf-8');
            return {
                [ filePath ]: 'File created successfully',
            }
        } catch (err) {
            return {
                [ filePath ]: `Error creating file: ${err.message}`,
            }
        }
    }));

    res.status(200).json({
        message: 'File creation results',
        results,
    });
})


export default httpServer;

