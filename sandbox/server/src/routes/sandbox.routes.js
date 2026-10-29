import { Router } from "express";
import { createPod, deletePod, findProjectSandbox, getPodStatus, getSandboxProjectId, waitForPodDeletion } from '../kubernetes/pod.js';
import { createService, deleteService } from '../kubernetes/service.js';
import { createSandboxKey, deleteSandboxKey } from '../config/redis.js';
import { deleteProjectObjects } from '../storage/s3.js';
import { v7 as uuid } from "uuid"
import { authMiddleware } from "../middlewares/auth.middleware.js";
import Project from "../models/project.model.js";
import { previewUrl } from '../config/hosts.js';



const router = Router();
const sandboxIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const projectIdPattern = /^[0-9a-f]{24}$/i;

const ignoreNotFound = async (operation) => {
    try {
        await operation();
    } catch (error) {
        if (error?.code !== 404 && error?.response?.statusCode !== 404) throw error;
    }
};


router.post('/project', authMiddleware, async (req, res) => {
    const { title } = req.body;

    const newProject = new Project({
        user: req.user.id,
        title
    });

    await newProject.save();

    return res.status(201).json({
        message: 'Project created successfully',
        project: newProject
    });
})

router.post("/start", authMiddleware, async (req, res) => {

    const projectId = req.body.projectId;

    // Verify that the project belongs to the authenticated user
    const project = await Project.findOne({ _id: projectId, user: req.user.id });

    if (!project) {
        return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const existingSandboxId = await findProjectSandbox(projectId);
    if (existingSandboxId) {
        await createSandboxKey(existingSandboxId);
        return res.status(200).json({
            message: 'Existing sandbox environment reused successfully',
            projectId,
            sandboxId: existingSandboxId,
            previewUrl: previewUrl(existingSandboxId)
        });
    }

    const sandboxId = uuid();

    await Promise.all([
        createPod(sandboxId, projectId),
        createService(sandboxId),
        createSandboxKey(sandboxId)
    ]);

    return res.status(201).json({
        message: 'Sandbox environment created successfully',
        projectId,
        sandboxId,
        previewUrl: previewUrl(sandboxId)
    })
})

router.get("/status/:sandboxId", authMiddleware, async (req, res) => {
    const { sandboxId } = req.params;

    if (!sandboxIdPattern.test(sandboxId)) {
        return res.status(400).json({ message: 'Invalid sandbox ID' });
    }

    try {
        return res.status(200).json(await getPodStatus(sandboxId));
    } catch (error) {
        if (error?.code === 404 || error?.response?.statusCode === 404) {
            return res.status(404).json({ message: 'Sandbox not found' });
        }

        console.error('Failed to read sandbox status:', error);
        return res.status(500).json({ message: 'Failed to read sandbox status' });
    }
})

router.get("/project", authMiddleware, async (req, res) => {
    const projects = await Project.find({ user: req.user.id });

    return res.status(200).json({
        message: 'Projects retrieved successfully',
        projects
    })
})

router.delete('/:sandboxId', authMiddleware, async (req, res) => {
    const { sandboxId } = req.params;
    const { projectId } = req.body ?? {};

    if (!sandboxIdPattern.test(sandboxId)) {
        return res.status(400).json({ message: 'Invalid sandbox ID' });
    }

    if (!projectIdPattern.test(projectId ?? '')) {
        return res.status(400).json({ message: 'Invalid project ID' });
    }

    try {
        const project = await Project.findOne({ _id: projectId, user: req.user.id });

        if (!project) {
            return res.status(404).json({ message: 'Project not found or access denied' });
        }

        try {
            const runningProjectId = await getSandboxProjectId(sandboxId);
            if (runningProjectId !== projectId) {
                return res.status(409).json({ message: 'Sandbox does not belong to this project' });
            }
        } catch (error) {
            if (error?.code !== 404 && error?.response?.statusCode !== 404) throw error;
        }

        await Promise.all([
            ignoreNotFound(() => deletePod(sandboxId)),
            ignoreNotFound(() => deleteService(sandboxId)),
            deleteSandboxKey(sandboxId)
        ]);

        await waitForPodDeletion(sandboxId);
        const deletedS3Objects = await deleteProjectObjects(projectId);
        await Project.deleteOne({ _id: projectId, user: req.user.id });

        return res.status(200).json({
            message: 'Project, sandbox, and stored files deleted successfully',
            sandboxId,
            projectId,
            deletedS3Objects
        });
    } catch (error) {
        if (error?.code === 404 || error?.response?.statusCode === 404) {
            return res.status(404).json({ message: 'Sandbox not found' });
        }

        console.error('Failed to delete project and sandbox:', error);
        return res.status(500).json({ message: 'Failed to delete project and sandbox data' });
    }
});


export default router;
