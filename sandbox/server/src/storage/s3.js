import {
    DeleteObjectsCommand,
    ListObjectVersionsCommand,
    S3Client
} from '@aws-sdk/client-s3';

const bucketName = process.env.S3_BUCKET_NAME;
const s3Client = new S3Client({ region: process.env.AWS_REGION });

export async function deleteProjectObjects(projectId) {
    if (!bucketName) {
        throw new Error('S3_BUCKET_NAME is required to delete project data');
    }

    const prefix = `${projectId}/`;
    let deletedCount = 0;

    // The bucket is versioned. Repeatedly read the first page so deleting a page
    // cannot invalidate pagination markers and leave older versions behind.
    while (true) {
        const page = await s3Client.send(new ListObjectVersionsCommand({
            Bucket: bucketName,
            Prefix: prefix,
            MaxKeys: 1000
        }));

        const objects = [
            ...(page.Versions ?? []),
            ...(page.DeleteMarkers ?? [])
        ].map(({ Key, VersionId }) => ({ Key, VersionId }));

        if (objects.length === 0) break;

        const result = await s3Client.send(new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: {
                Objects: objects,
                Quiet: true
            }
        }));

        if (result.Errors?.length) {
            const failures = result.Errors
                .map(({ Key, Code }) => `${Key}: ${Code}`)
                .join(', ');
            throw new Error(`Failed to delete some S3 project objects: ${failures}`);
        }

        deletedCount += objects.length;
    }

    return deletedCount;
}
