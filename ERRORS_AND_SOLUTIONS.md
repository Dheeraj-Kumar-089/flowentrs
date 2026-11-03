# Agent/Preview HTTPS and Sandbox 504 Incident

Date: 2026-11-07  
Environment: EKS and Classic Load Balancer in `ap-south-1`

## Symptoms

- Browser requests to `https://<sandbox-id>.agent.projectrs.me` failed with `ERR_CERT_AUTHORITY_INVALID`.
- Socket.IO WebSocket connections to `wss://<sandbox-id>.agent.projectrs.me` failed.
- Requests returned `504 Gateway Timeout` after TLS validation was bypassed.

## Error 1: Invalid HTTPS/WSS certificate

### Confirmed cause

The wildcard DNS records correctly pointed to the EKS load balancer, but port 443 was configured as raw TCP to ingress-nginx. The Kubernetes Ingress had no TLS configuration, so ingress-nginx served its self-signed default certificate:

```text
CN=Kubernetes Ingress Controller Fake Certificate, O=Acme Co
```

The existing wildcard certificate for `*.preview.projectrs.me` and `*.agent.projectrs.me` was in `us-east-1`. An ACM certificate can only be attached to a load balancer in the same AWS Region, while the EKS load balancer is in `ap-south-1`.

### Permanent solution applied

1. Requested an ACM certificate in `ap-south-1` covering:
   - `*.preview.projectrs.me`
   - `*.agent.projectrs.me`
2. Reused the existing valid DNS-validation CNAME records in Namecheap.
3. Configured the ingress-nginx LoadBalancer Service to terminate TLS with ACM and forward decrypted HTTP to nginx.
4. Stored the Service configuration in `k8s/ingress-nginx-service.yml` so it can be reapplied during deployments.

Certificate ARN:

```text
arn:aws:acm:ap-south-1:360821545863:certificate/3d315370-9040-4094-b618-8cc9fa87ba85
```

Verification:

```text
Load balancer listener: HTTPS:443 -> HTTP backend
Public TLS verification result: 0 (valid)
```

Keep both ACM DNS-validation CNAME records in Namecheap permanently so ACM can renew the certificate automatically.

## Error 2: 504 Gateway Timeout

### Confirmed cause

The sandbox pod was `2/3 Ready`. Its `sync-agent-container` initially used the wrong region and S3 returned:

```text
PermanentRedirect: The bucket you are attempting to access must be addressed using the specified endpoint.
Endpoint: cohort-codespace-bucket.s3-ap-southeast-1.amazonaws.com
```

After correcting the region, S3 returned `403 AccessDenied`. Further verification proved:

- `flowent-eks-user` has an identity policy allowing the required S3 actions.
- `cohort-codespace-bucket` is not owned by AWS account `360821545863`.
- The external bucket owner has not granted this account access.

Because the sync-agent container was not running, Kubernetes marked the whole pod unready and withheld its Service endpoint. The router therefore returned 504 even though the main agent container was running.

### Permanent solution applied

- Created `projectrs-sandbox-workspaces-360821545863-ap-south-1` in the same AWS account and Region as EKS.
- Enabled S3 public-access blocking, versioning, and server-side encryption.
- Replaced the hard-coded external bucket with the required `S3_BUCKET_NAME` configuration.
- Set `AWS_REGION=ap-south-1` and the new bucket name in the repository and live Kubernetes Secret.
- Built and pushed immutable `v1` images for `sync-agent` and `sandbox`.
- Deployed the corrected sandbox API image successfully.
- Verified the corrected sync-agent end-to-end in EKS: the pod became Ready, listed the new bucket, and started its file watcher without an S3 error.

Environment variables and container images are fixed when a pod starts. Sandboxes created before this deployment must be replaced. Create a new sandbox after this fix. Do not delete an old sandbox until any required files in its `emptyDir` workspace have been backed up.

## Error 3: Corrected image existed, but an old API pod still created broken sandboxes

### Confirmed cause

The corrected `sandbox:v1` deployment initially could not schedule because the cluster reported `Insufficient cpu`. Kubernetes' default rolling-update strategy kept the previous Skaffold-managed sandbox API pod running. That old API continued accepting `/api/sandbox/start` requests and created sandbox pods with:

- the old untagged sync-agent image;
- no `S3_BUCKET_NAME` environment variable.

The sandbox `01a1b5de-4367-76f8-977a-da738fe0d3fd` was created by that old API pod. Its sync-agent failed, the pod stayed `2/3 Ready`, its Service had only `notReadyAddresses`, and ingress returned 504 for both `/list-files` and the Socket.IO connection.

### Permanent solution applied

- Set the one-replica sandbox API Deployment strategy to `Recreate`, allowing the old pod to stop before the replacement is scheduled on the CPU-constrained cluster.
- Applied the Deployment and verified the corrected API pod became `Running` and `Ready`.
- Added the ingress-nginx LoadBalancer Service manifest to `skaffold-eks.yaml` so a future Skaffold deployment preserves the ACM TLS listener configuration.

Existing sandbox pod specifications are immutable. The affected UUID cannot acquire the corrected image or environment after it has started; create a new sandbox after the corrected API rollout.

## Sandbox URL generation and routing

`POST /api/sandbox/start` generates a UUID v7 in `sandbox/server/src/routes/sandbox.routes.js`. That UUID becomes the Kubernetes pod/service suffix and the first DNS label of the runtime URLs:

```text
https://<uuid>.preview.projectrs.me
https://<uuid>.agent.projectrs.me
```

Namecheap wildcard CNAME records for `*.preview` and `*.agent` point directly to the EKS load balancer. The ingress sends both wildcard domains to `router-service`, which extracts the UUID and proxies to `sandbox-service-<uuid>`. These runtime subdomains do not pass through the frontend CloudFront distribution.

## Deployment order

```powershell
kubectl apply -f k8s/secrets.yml
kubectl apply -f k8s/ingress-nginx-service.yml
kubectl apply -f k8s/ingress.yml
kubectl apply -f k8s/sandbox-deployment.yml
```

Reapplying the upstream ingress-nginx installation manifest may overwrite the LoadBalancer Service. If that happens, always reapply `k8s/ingress-nginx-service.yml` afterward.

A full Skaffold rerun is not required to repair an already-created sandbox. After an API image/configuration rollout, create a new sandbox because Kubernetes cannot mutate the old pod's container image/environment specification in place.

## Verification commands

```powershell
kubectl get service ingress-nginx-controller -n ingress-nginx -o yaml
kubectl get pods
kubectl get endpoints <sandbox-service-name> -o yaml
curl.exe -I https://<sandbox-id>.agent.projectrs.me/list-files
```

A healthy new sandbox should be `3/3 Ready`, have a ready Service endpoint, pass TLS validation, and return an application response instead of 504.

## Error 4: Intermittent first load, terminal failure, and hidden AI failure

### Confirmed causes

- Each sandbox requested `750m` CPU and `1500Mi` memory although measured idle usage was approximately `3m` CPU and `150Mi` memory. Two sandboxes consumed 95% of each `t3.medium` node's requested CPU, leaving later sandboxes Pending with `Insufficient cpu` and `Insufficient memory`.
- `/api/sandbox/start` returned before the pod or its HTTP servers were ready. The frontend immediately opened preview, file, and Socket.IO requests against a Service with no ready endpoint.
- Socket.IO polling was healthy for a Ready sandbox, but a WebSocket-only test returned HTTP 400. The Classic Load Balancer used an HTTPS-to-HTTP listener, which handled the request at layer 7 instead of preserving the HTTP Upgrade connection.
- Gemini returned HTTP 401 because the deployed `GEMINI_API_KEY` is invalid. The AI route had already sent HTTP 200 headers, so it hid this upstream failure from the frontend.

### Permanent solution applied

- Right-sized sandbox requests to `60m` CPU and `256Mi` memory total while retaining burst limits.
- Added HTTP readiness probes for the Vite preview and agent server.
- Added an authenticated sandbox-status endpoint and made the frontend wait for `3/3 Ready` before opening the IDE.
- Added a `projectId` pod label and reuse lookup so reopening the same project returns its active sandbox instead of consuming capacity with duplicate pods.
- Made terminal reconnection persistent for temporary network interruptions.
- Changed the Classic Load Balancer listener to SSL-to-TCP so TLS still terminates with ACM while WebSocket Upgrade headers pass unchanged to ingress-nginx.
- Changed AI streaming so upstream failures return a real error response before streaming starts, and made the frontend display the server error.

The Gemini API key is an external credential and must be replaced in the `ai-secret` Kubernetes Secret before AI generation can succeed.

## Error 5: AI returns 504 after installing a valid Gemini key

### Confirmed cause

The replacement key was valid and Google returned the configured `gemini-3.8-flash` model in the models API. However, the first agent/model step sent no response bytes while it was processing. CloudFront's EKS origin read timeout was 30 seconds, and ingress recorded the browser request closing at exactly 30 seconds with status 499. The browser consequently received a CloudFront 504.

### Permanent solution applied

- Open the event stream and flush response headers immediately.
- Send an SSE heartbeat every 10 seconds so CloudFront never observes a 30-second idle origin connection.
- Disable ingress-nginx response buffering for streamed AI output.
- Ignore SSE comment/heartbeat lines in the frontend.
- Abort LangChain execution when the requesting browser disconnects, avoiding orphaned model work.
- Made the Gemini model configurable with `GEMINI_MODEL` and selected `gemini-3.6-flash`; direct tests with the deployed key completed in about 1.9 seconds, while `gemini-3.8-flash` took approximately 137 seconds to reach its first tool call.

## Error 6: AI stops after updating several files with `Error: AI request failed`

### Confirmed cause

The AI pod logged HTTP `429 RESOURCE_EXHAUSTED`. The Gemini project was on the free tier, which allowed 5 generate-content requests per minute for `gemini-3.6-flash`. An agent task uses another model request after each tool result. Separate read and update calls caused the sixth model turn to exceed the per-minute quota even though the API key was valid.

Gemini quotas apply per Google Cloud project, not per API key. Creating another key in the same project does not increase the quota.

### Permanent application solution applied

- Require one batched `read_files` call for all initially required files.
- Require one batched `update_files` call for all related changes.
- Retry only failed model turns for HTTP `429`, `500`, `502`, `503`, and `504`, using 35/52.5/60-second backoff delays.
- Preserve completed tool calls during retry, so already-written files are not written a second time.
- Keep the SSE connection alive during backoff with the existing 10-second heartbeat.
- Return the actual quota or availability cause if automatic retries are exhausted.

For production traffic or multiple concurrent users, enable billing for the Gemini API project in Google AI Studio. Application retries handle short bursts, but cannot add quota or bypass a daily/spend limit.

## Error 7: `ResourceInUseException` while upgrading the EKS node group

### Confirmed cause

The first `update-nodegroup-version` request had already started the `express-nodes` rollout. A second request was sent while the managed node group was `UPDATING`, so EKS correctly rejected the competing operation with `Nodegroup cannot be updated as it is currently not in Active State`.

### Permanent solution applied

- Followed the existing EKS update instead of forcing or starting another update.
- Verified the rollout had no AWS update errors, the replacement Kubernetes `1.35` nodes became Ready, workloads moved successfully, and the old `1.34` nodes were drained and removed.
- Confirmed the managed node group returned to `ACTIVE` on Kubernetes `1.35`.
- Updated CoreDNS to `v1.13.2-eksbuild.68` and kube-proxy to `v1.35.3-eksbuild.64`; metrics-server and VPC CNI were already on the recommended Kubernetes 1.35 builds.
- Added persistent HPA and Cluster Autoscaler manifests so later Skaffold deployments preserve the corrected autoscaling flow.

The node-group command must only be run while the group is `ACTIVE`. If a previous update is already running, inspect and wait for it instead of submitting a competing update:

```powershell
aws eks describe-nodegroup --cluster-name express-cluster --nodegroup-name express-nodes --region ap-south-1 --query "nodegroup.status" --output text
aws eks wait nodegroup-active --cluster-name express-cluster --nodegroup-name express-nodes --region ap-south-1
```

## Error 8: Cluster Autoscaler could scale but logged `eks:DescribeNodegroup` AccessDenied

### Confirmed cause

The eksctl-created IRSA role only had the AWS-managed `AutoScalingFullAccess` policy. That policy allowed the EC2 Auto Scaling operation but did not grant the Kubernetes 1.35 autoscaler permission to call `eks:DescribeNodegroup`.

### Permanent solution applied

- Added `k8s/cluster-autoscaler-iam-policy.json`, based on the AWS EKS least-privilege policy.
- Limited scale mutations to Auto Scaling Groups tagged for `express-cluster`.
- Included the required Auto Scaling, EC2 discovery, and `eks:DescribeNodegroup` read actions.
- Attached it to the Cluster Autoscaler IRSA role as `ClusterAutoscalerScopedPolicy` and restarted the deployment.
- Verified the new leader discovers the managed node group without an authorization error.

The ServiceAccount role annotation is created and owned by `eksctl`; it is intentionally not hard-coded in `k8s/cluster-autoscaler.yml`. This keeps the Kubernetes manifest reusable when eksctl generates a different role name.

The role is managed by eksctl and still has its older `AutoScalingFullAccess` attachment. It was not silently detached during this repair. The scoped repository policy now contains every permission the autoscaler needs and can replace the broad attachment after that eksctl-managed role is deliberately migrated.

## Error 9: Modified sandbox preview becomes a pure white page

### Confirmed cause

The generated project imported Tailwind with `@import "tailwindcss"` and used Tailwind utility classes, but its `package.json` did not include `tailwindcss` or `@tailwindcss/vite`, and `vite.config.js` did not register the Tailwind Vite plugin. Vite therefore stopped compiling with:

```text
Unable to resolve @import "tailwindcss"
[postcss] ENOENT: no such file or directory, open 'tailwindcss'
```

The preview iframe had no build-health reporting and used a white background, so this compilation failure appeared as an unexplained blank white page.

An initial dependency repair also exposed a platform mismatch: dependencies installed in the Debian-based agent selected the glibc `lightningcss` native binary, while the Alpine preview container required the musl binary. The preview then failed with `Cannot find module '../lightningcss.linux-x64-musl.node'`.

### Permanent solution applied

- Added `tailwindcss` and `@tailwindcss/vite` to the sandbox template and registered the Tailwind Vite plugin.
- Changed the agent image to Alpine so dependency installation and preview execution select the same musl-compatible native modules.
- Made file updates automatically install dependencies when package manifests change.
- Added a production Vite build validation after AI file updates; the AI must repair a failed build instead of reporting completion.
- Added `/project-status` and `/validate-project` agent endpoints and a visible, accessible build-error panel in the preview with the exact compiler output and a **Validate again** action.
- Published immutable template and agent images tagged `v1` and configured new sandbox pods to use them.
- Repaired the active project, verified its production build, and confirmed its public preview returns HTTP 200 and renders the modified interface.

Existing sandboxes retain the image they started with. The active project was repaired in place; newly created sandboxes receive the complete permanent validation flow automatically.

## New features

### Preview build validation and recovery

- Sandbox file updates now trigger a real production build, not only a development-server write.
- Dependency changes are installed automatically inside the same Linux platform used by the preview.
- Build state is available through the agent API and is polled by the workspace preview.
- Compilation failures are shown as an IDE-style error panel with compiler details, an accessible alert, and an explicit retry action instead of an unexplained white iframe.
- AI code generation receives structured validation results and must continue repairing the project until the build passes.

### Flowent home and workspace UI

- Replaced the original splash screen with the existing Flowent dark/amber Cloud IDE visual direction while preserving the current authenticated project creation, sandbox reuse, and readiness polling behavior.
- Made `https://www.projectrs.me/` the canonical home view and added a Home action inside the workspace.
- Added authenticated session/profile and logout endpoints for the landing page.
- Changed panel and control geometry to square `0px` corners while retaining circular status indicators.
- Added responsive layout, visible keyboard focus, reduced-motion support, higher-contrast tokens, and SVG interface icons.
- Replaced the rotating spotlight with a pointer-following amber grid glow that highlights nearby square cells, stays at `z-index: 0`, avoids React rerenders, and remains decorative on touch devices.

### EKS workload and node autoscaling

- Added CPU-based Horizontal Pod Autoscalers for the AI, authentication, notification, router, and sandbox API Deployments with a 50% average CPU target.
- Added a persistent Kubernetes `1.35` Cluster Autoscaler deployment using the real `express-cluster` ASG discovery tag instead of the literal placeholder.
- Added a tag-scoped Cluster Autoscaler IAM policy, including the required managed-node-group discovery permission.
- Added both autoscaling manifests to `skaffold-eks.yaml` so the complete traffic spike → HPA replicas → Pending pods → EC2 node scale-out flow survives future deployments.
- Verified the flow live: controlled router CPU load caused HPA to scale from 1 to 4 Ready replicas; a CPU-constrained test pod then became Pending, caused a third EC2 node to join, and was scheduled on the new node. After the test workload was removed, Cluster Autoscaler drained and terminated the extra EC2 node following its normal safety window, returning the cluster to two Ready nodes.

### VS Code-style file experience

- Rebuilt the read-only file viewer with Prism syntax highlighting, line numbers, an editor tab, breadcrumbs, language status, copy action, and a VS Code-style status bar.
- Reworked Explorer into a denser directory tree with file-type labels, active-row highlighting, retry feedback, and square panels.

### AI activity privacy

- AI progress now displays only generic states such as `Listing project files`, `Reading project files`, and `Updating project files`.
- File names returned by AI tool activity are no longer rendered in the chat progress log.

### AI provider fallback chain

- AI model calls use Gemini first, then fall back in order to Groq `qwen/qwen3.8-27b`, Groq `openai/gpt-oss-120b`, and OpenRouter `openrouter/free`.
- The fallback runs for every model turn, including turns after file tools execute, so completed tool work and conversation state are preserved.
- The complete provider chain is retried only when all configured providers fail, preventing a Gemini quota error from delaying the first Groq attempt.
- Groq and OpenRouter credentials are stored only in the ignored Kubernetes secret and the live `ai-secret`; the tracked example contains placeholders.
- The AI container now uses Node.js 22 and production dependencies because the current LangChain/OpenAI SDK requires Node.js 22 or newer.

### Terminal shell identity

- New sandbox agent containers start an interactive Bash shell with the prompt `flowent@workspace:\\w$`.
- A connecting browser receives the current shell directory, so the terminal visibly identifies both the workspace and working directory immediately.

### Delete project and sandbox data from the UI

- Added a strongly confirmed Delete project action to the workspace toolbar.
- Added `DELETE /api/sandbox/:sandboxId` with sandbox/project ID validation and authenticated MongoDB project ownership verification.
- Deletion stops the Kubernetes pod before storage cleanup, then removes its Service and Redis expiry key, every S3 object version and delete marker under the project's isolated prefix, and finally the MongoDB project record.
- S3 cleanup is version-aware because the workspace bucket has Versioning enabled; deleting only current objects would leave old file versions and storage charges behind.
