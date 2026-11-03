# Flowent deployment ka complete Hinglish guide

Deployment record: 14 November 2026. Yeh guide current capstone project ke EKS se EC2/k3s migration, public deployment, wake system, security, maintenance aur rollback ko explain karti hai. Resource state aur test results neeche last deployment verification ke hain; yeh live monitoring report nahi hai.

Project URL: **https://www.projectrs.me**

## 1. Ab project kis tarah deployed hai?

Frontend S3 aur CloudFront par hai. Backend aur user ke sandbox ek EC2 instance par k3s ke andar chalte hain. Backend idle hone par EC2 stop ho sakta hai. Website ka static homepage phir bhi available rehta hai. Viewer private demo access code enter karke server start kar sakta hai.

Purana EKS cluster aur uska dedicated infrastructure approval ke baad delete kar diya gaya. Ab us cluster ka control plane, worker nodes, load balancer aur NAT gateway is deployment ke liye running nahi hain.

```text
Viewer ka browser
  |
  +-- www.projectrs.me / projectrs.me
  |     CloudFront
  |       +-- Static pages / assets: S3, portfolio/v1/
  |       +-- /api/*: HTTPS origin api.projectrs.me
  |
  +-- Demo wake button + private access code
  |     API Gateway HTTP API
  |       Lambda: designated EC2 instance start karta hai
  |
  +-- api.projectrs.me / agent-<id>.projectrs.me / preview-<id>.projectrs.me
        Elastic IP: 43.205.61.128
          Host Nginx: HTTPS / WebSocket handling
            ingress-nginx: NodePort 31618
              Single-node k3s cluster
                +-- auth
                +-- AI orchestration
                +-- sandbox manager
                +-- sandbox router
                +-- Har active sandbox ka separate pod
                      template + agent + sync-agent

Backend dependencies: configured MongoDB, Redis, RabbitMQ aur AI providers.
Workspace files: configured S3 bucket; frontend bucket se alag purpose.
Docker images: Amazon ECR.
Idle shutdown: EC2 ke systemd timer se.
```

Single EC2 ek hi failure point hai. Yeh occasional portfolio/interview demo ke liye choose kiya gaya hai. Instance stopped ho to login, backend APIs, AI, terminal aur preview wake hone tak available nahi honge.

## 2. Important resources aur identifiers

| Resource | Current deployment mein value / role |
| --- | --- |
| AWS region | `ap-south-1` — Mumbai |
| AWS account | `360821545863` |
| Deployment IAM user | `flowent-eks-user` |
| Website | `https://www.projectrs.me` |
| CloudFront distribution | `E1MTXFSZU81DQ4` |
| CloudFront hostname | `dgpjtz28n9zdi.cloudfront.net` |
| Frontend S3 bucket | `flowent-frontend` |
| Live frontend prefix | `portfolio/v1/` |
| EC2 name | `flowent-server` |
| EC2 instance | `i-0de960ffd53719da8` |
| EC2 size | `t3.medium` |
| Retained root storage | 16 GiB gp3 EBS |
| Elastic IP | `43.205.61.128` |
| EIP allocation | `eipalloc-00a0cccb29021586d` |
| Demo VPC | `vpc-0b0e2353d06bb5892` |
| Wake CloudFormation stack | `flowent-portfolio-wake` |
| Wake API base URL | `https://wtajdsltp5.execute-api.ap-south-1.amazonaws.com/v1` |
| Backend API hostname | `api.projectrs.me` |
| DNS provider | Namecheap |
| VM staging directory | `/home/ubuntu/capstone-deploy/` |
| Local recovery material | `portfolio/rollback.local/`, Git-ignored |

Resource IDs aur hostnames credentials nahi hain. Passwords, private keys, access tokens aur wake code is guide mein include nahi kiye gaye hain.

## 3. Kaunsi application services use ho rahi hain?

| Component | Kaam | Current status |
| --- | --- | --- |
| React/Vite frontend | Homepage, projects, editor, terminal aur demo wake UI | S3/CloudFront se live |
| `auth` | Google sign-in routes, session aur authentication | k3s deployment |
| `ai-orchestration` | AI requests aur agent workflow | k3s par 1 replica |
| `sandbox` | Projects aur sandbox pod/service lifecycle | k3s deployment |
| `router` | Hostname ke basis par preview/agent traffic route karna | k3s deployment |
| `template` | Workspace seed aur Vite preview server | Har sandbox pod mein |
| `agent` | Workspace actions aur WebSocket terminal | Har sandbox pod mein |
| `sync-agent` | Workspace files ko S3 ke saath sync karna | Har sandbox pod mein |
| `notification` | Email notifications | Image built; service deploy nahi ki |
| MongoDB connections | Auth aur project data | Existing configured endpoints retained |
| Redis | Sandbox TTL aur expiry events | Existing configured endpoint retained |
| RabbitMQ | Auth event publishing / message queue | Existing configured endpoint retained |

MongoDB, Redis aur RabbitMQ ke liye is migration mein naye managed AWS database clusters create nahi kiye gaye. Unke exact hosts aur credentials local configuration mein hain. Unka provider plan, quota aur external bill alag check karna hoga.

## 4. Purana EKS setup kyun hataya?

Use case occasional demo tha: tum, friend ya interviewer project kholega. Always-running EKS control plane, workers aur network infrastructure is use case ke liye recurring cost badha rahe the.

Single EC2 par k3s rakhne se existing Kubernetes workloads reuse ho gaye. Application ko Docker Compose ya kisi naye platform ke liye poora rewrite nahi karna pada. Static frontend ko EC2 se separate rakhne se homepage backend stop hone par bhi load hota hai.

EC2 stop karne se uski normal compute billing rukti hai. EBS disk, retained public IPv4 aur doosri retained services ka charge continue ho sakta hai. Isliye yeh low-cost setup hai; guaranteed free hosting nahi hai. [AWS stop/start documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Stop_Start.html)

## 5. Deployment mein kya-kya kiya gaya?

### 5.1 Existing environment inspect kiya

Existing `flowent-server` VM par isi Flowent project ka older deployment mila. k3s, ingress-nginx aur host Nginx already present the. Purane application mein 7 long-running sandbox pods aur 37 orphaned sandbox services mile.

Public routing, current resources aur dependencies inspect karne ke baad isi VM ko reuse kiya. Application replacement ke waqt k3s aur ingress controller preserve kiye. Purana VM source folder short-term recovery ke liye chhoda gaya.

### 5.2 Application aur runtime integration adjust ki

- Homepage ke global `overflow: hidden` issue ko landing-page specific scrolling se address kiya.
- Mobile layout mein stacked panels, touch-friendly controls aur workspace scrolling ke rules add kiye.
- Static frontend mein backend unavailable state aur access-code based wake UI add ki.
- Frontend aur backend ko flat sandbox hostnames support karne ke flags diye.
- Sandbox image selection ko numeric release tag se connect kiya.
- Sandbox readiness checks aur existing project sandbox reuse support add kiya.
- Disposable verification project ke pod, service aur stored objects cleanup ka flow verify kiya.

Checkout mein pehle se uncommitted application changes bhi the. Har changed file ko is migration ka change samajh kar blanket revert nahi karna chahiye. Current source mein mobile fixes hain; real-phone manual check maintenance checklist mein diya gaya hai.

### 5.3 Docker images build aur ECR push ki

Current checkout se 8 images build karke ECR par `v1` tag push aur verify kiya:

```text
ai-orchestration:v1
auth:v1
notification:v1
agent:v1
sync-agent:v1
router:v1
sandbox:v1
template:v1
```

Registry: `360821545863.dkr.ecr.ap-south-1.amazonaws.com`.

Portfolio deployment 7 images use karta hai. Notification image available hai, lekin service disabled hai. Purane `latest` tags ko overwrite nahi kiya. Aage `v2`, `v3`, `v4` use karo; date wale release tags ki zarurat nahi hai.

### 5.4 Secrets carefully provision kiye

`k8s/secrets.yml` local machine par hi raha. Original YAML file ko upload, Git push ya directly apply nahi kiya.

Application ko required credentials chahiye the. `provision-secrets.mjs` ne local file validate karke sirf required values ke 5 Kubernetes Secret objects SSH ke through create kiye. Original file transfer nahi hui. Details section 9 mein hain.

Google refresh token placeholder tha. Tumhari instruction ke according us value ko omit kiya aur email notification service skip ki.

### 5.5 Existing EC2 app replace ki

Guarded migration se purane Flowent app ke workloads, stale sandbox pods aur orphaned services remove kiye. Replacement secrets ready hone ke baad current application deploy ki.

Current deployment mein 4 core deployments hain: auth, AI orchestration, router aur sandbox manager. AI ko 1 replica par rakha. Sandbox workloads demand par separate pods mein aate hain.

Deployment script selected non-secret manifests apply karta hai. EKS load balancer, cluster autoscaler aur EKS-specific autoscaling resources is EC2 path mein apply nahi kiye.

### 5.6 Elastic IP aur DNS set kiya

Tumhari approval se Elastic IP allocate karke EC2 ko attach ki. Isse normal stop/start ke baad public target stable rehta hai.

Namecheap par tumne existing wildcard `*` record ko A record `43.205.61.128` mein change kiya. Explicit `api` record nahi tha; `api.projectrs.me` wildcard se resolve hota hai. `@` aur `www` ke CloudFront records preserve kiye.

### 5.7 Wake API deploy ki

CloudFormation/SAM se Lambda aur API Gateway HTTP API deploy ki. IAM user ko required permissions add karne mein tumne help ki. Successful stack state `CREATE_COMPLETE` verify hui.

Wake API code verify karke sirf designated instance start karti hai. Start permission poore account ke instances ke liye nahi di gayi.

### 5.8 Frontend publish aur CloudFront switch kiya

Wake URL, flat hostname mode aur `K3S` runtime label ke saath frontend build kiya. Build ko `s3://flowent-frontend/portfolio/v1/` par upload kiya. Original S3 root build untouched rakha.

CloudFront default S3 origin ka path `/portfolio/v1` set kiya. `/api/*` behavior ko HTTPS origin `api.projectrs.me` par switch kiya. Cache invalidation ke baad public HTML, JavaScript aur CSS local deployed build se byte-for-byte compare kiye.

### 5.9 Reboot issue fix aur idle timer enable kiya

Real EC2 stop/start test ke baad AppArmor compatibility issue mila. Isse ingress Nginx reload fail ho raha tha aur origin 502 aa raha tha. Exact runtime profile fix ke baad doosra real boot aur HTTPS checks pass hue.

Public cutover ke baad `flowent-idle.timer` enable kiya. Timer ki safety tests aur initial service run pass hue.

### 5.10 Purana EKS infrastructure delete kiya

Delete karne se pehle cluster resources inspect kiye. Active EKS sandboxes aur persistent volumes nahi mile. CloudFormation templates aur non-secret Kubernetes configuration ignored local backups mein save ki.

Tumhari approval ke baad `express-cluster` aur uska dedicated infrastructure delete kiya. Removal ke baad new EC2 route ka public HTTPS auth check pass hua.

## 6. DNS aur request routing samjho

| Host / path | Target | Reason |
| --- | --- | --- |
| `projectrs.me`, `www.projectrs.me` | CloudFront | Frontend EC2 sleep mein bhi available |
| CloudFront default path | S3 origin, `/portfolio/v1` | Current frontend files |
| CloudFront `/api/*` | `api.projectrs.me`, HTTPS | Backend APIs |
| Namecheap `*` A record | `43.205.61.128` | API aur dynamic sandbox hosts |
| `agent-<sandbox-id>.projectrs.me` | EC2 router se agent | Terminal aur workspace actions |
| `preview-<sandbox-id>.projectrs.me` | EC2 router se template | User app preview |

Exact DNS records wildcard se zyada specific hote hain. Existing `www` record CloudFront ko point karta hai, isliye wildcard usko replace nahi karta. Agar future mein explicit `api` record add karo, uska target bhi current EC2 Elastic IP hona chahiye.

Flat names ka reason TLS certificate coverage hai. `*.projectrs.me` certificate `agent-123.projectrs.me` ko cover kar sakta hai. Wahi wildcard `123.agent.projectrs.me` jaise extra-level hostname ko cover nahi karta.

Purane nested sandbox DNS records current flat deployment ke liye required nahi hain. DNS records blindly delete mat karo; pehle check karo ki koi old integration unko use to nahi kar raha.

CloudFront API origin TLS 1.2 ke saath HTTPS use karta hai. Viewer Host forwarding ke liye ingress mein main site ke hosts bhi defined hain. Existing SPA 403/404 fallback responses preserve kiye. Optional extra error-cache configuration AWS ne reject ki thi; usse deployed assume mat karna.

## 7. TLS kya hai?

**TLS ka full form Transport Layer Security hai.** HTTPS, HTTP ko TLS ke secure connection ke andar send karta hai.

TLS ke teen main kaam hain:

1. **Encryption:** Browser aur server ke beech data transit mein encrypt hota hai.
2. **Server identity:** Browser certificate validate karta hai ki connected server requested domain ke liye trusted certificate present kar raha hai.
3. **Integrity:** Connection ke data mein beech mein alteration detect karne mein help milti hai.

Example: login ke time session data plain HTTP par bhejne ke bajay HTTPS connection mein travel karta hai. TLS application ke bugs, stolen passwords ya unsafe terminal access ko khud fix nahi karta. Authentication aur authorization alag controls hain. [TLS standard](https://www.rfc-editor.org/rfc/rfc8446.html)

Is deployment mein browser-to-CloudFront HTTPS aur CloudFront-to-EC2 API origin HTTPS alag connections hain. Direct sandbox hosts EC2 ke certificate use karte hain. Nginx se internal NodePort wali hop HTTP hai; ise poore cluster ke andar end-to-end TLS mat samajhna. S3 website origin bhi HTTPS endpoint nahi hai.

### 7.1 Current EC2 certificate aur renewal

Last deployment check mein EC2 ka Let's Encrypt certificate `projectrs.me` aur `*.projectrs.me` cover karta tha. **Recorded expiry 18 December 2026 hai. Isse pehle renewal complete karo.**

Certbot manual DNS challenge use kar raha hai. Automated DNS authentication hook configured nahi hai. Sirf Certbot timer enabled hone se manual wildcard certificate renew nahi ho jayega. [Certbot manual renewal documentation](https://eff-certbot.readthedocs.io/en/stable/using.html#manual)

Renewal ke waqt EC2 start karo aur SSH session mein current certificate name/path inspect karo:

```bash
sudo certbot certificates
sudo nginx -T 2>/dev/null | grep -E 'server_name|ssl_certificate'
```

`certbot certificates` ka actual Certificate Name use karke existing manual DNS issuance command repeat karo. Neeche `ACTUAL_CERTIFICATE_NAME` ko output ke exact name se replace karna hai:

```bash
sudo certbot certonly --manual --preferred-challenges dns \
  --cert-name ACTUAL_CERTIFICATE_NAME \
  -d projectrs.me -d '*.projectrs.me'
```

Certbot jo TXT record de, Namecheap Advanced DNS mein usi name/value ke saath add karo. DNS challenge ke liye `_acme-challenge` record use hota hai; `*` A record ko replace mat karo. Agar same name ke multiple challenge values maange jaayen, verification tak required values saath rakho. DNS propagation verify karke prompt continue karo.

Certificate successfully issue hone ke baad actual certificate paths use karo. Existing TLS Secret bhi refresh karo aur host Nginx reload karo:

```bash
sudo k3s kubectl create secret tls portfolio-origin-tls \
  --cert=/etc/letsencrypt/live/ACTUAL_CERTIFICATE_NAME/fullchain.pem \
  --key=/etc/letsencrypt/live/ACTUAL_CERTIFICATE_NAME/privkey.pem \
  --dry-run=client -o yaml | sudo k3s kubectl apply -f -
sudo nginx -t
sudo systemctl reload nginx
```

Private key ko display, copy into documentation ya Git commit mat karo. Renewal ke baad API aur sandbox HTTPS certificate dobara check karo. CloudFront viewer certificate ka lifecycle alag hai; EC2 certificate renew karne se CloudFront certificate automatically change nahi hota.

## 8. Wake aur idle shutdown kaise kaam karta hai?

### 8.1 Viewer ke liye flow

1. Viewer `https://www.projectrs.me` kholta hai. Static homepage load hota hai.
2. Backend unavailable ho to frontend demo access code ka form dikhata hai.
3. Viewer correct private code enter karta hai.
4. Frontend wake API ke `POST /start` ko call karta hai.
5. Lambda designated EC2 instance ko start karti hai.
6. Frontend instance state aur application readiness check karta hai.
7. Services ready hone par normal login/project flow available hota hai.

Wake time ke andar EC2 boot, k3s, ingress aur application readiness sab aate hain. **30 seconds guaranteed nahi hain.** Warm images aur healthy services help karte hain, lekin slower boots possible hain.

Frontend status polling roughly 3-second intervals par karta hai. Instance `running` hona aur application ready hona alag states hain.

### 8.2 Access code aur permissions

- Private code local ignored file `portfolio/wake-code.local` mein hai.
- Plain code CloudFormation parameter mein nahi bheja gaya; uska SHA-256 hash use hota hai.
- API browser CORS origin `https://www.projectrs.me` tak restricted hai.
- Wrong code rejection aur unexpected Origin rejection verify hue.
- CORS ko authentication mat samajhna; code start action ka access gate hai.
- API stage throttling rate/burst 2 hai. Repeated requests par throttling aa sakti hai.
- Lambda `StartInstances` permission specified EC2 tak scoped hai.
- Lambda status ke liye `DescribeInstances` use karti hai.
- Access logs retention 7 days configured hai.

Code interviewer/friend ko privately share karo. Code ko frontend source, public README ya GitHub par mat daalo. Code leak ho to local code rotate karke wake stack redeploy karna padega; sirf file edit karne se deployed hash update nahi hota.

### 8.3 Idle shutdown timing

Sandbox Redis key ki TTL 20 minutes hai. Router ke HTTP requests TTL refresh karte hain. Key expire hone par sandbox manager pod aur service remove karta hai. Uske baad 10 minutes tak koi sandbox pod na ho to EC2 idle timer stop request bhejta hai.

```text
Last TTL-refreshing sandbox activity
  + roughly 20 minutes: Redis expiry aur sandbox cleanup
  + roughly 10 minutes without sandbox pods: EC2 stop request
  = roughly 30 minutes, cleanup / timer delays ke saath
```

Agar boot ke baad sandbox open hi nahi kiya, EC2 roughly 10 minutes baad stop ho sakta hai. Homepage visit ya login alone idle timer ko active sandbox nahi dikhata.

Current router mein har WebSocket frame TTL refresh nahi karta. Sirf terminal connection open rakhne ko guaranteed activity heartbeat mat samajhna. Redis expiry handling fail ho aur sandbox pod reh jaaye, idle script EC2 running chhod dega. Yeh condition charges badha sakti hai; troubleshooting mein pods aur logs inspect karo.

### 8.4 Timer ke safeguards

Timer minute mein ek baar check karta hai. IMDSv2 se actual instance identity verify hoti hai. Expected instance ID mismatch ho to stop nahi hota. Kubernetes query fail ho to idle assume nahi karta. Har new boot par purana idle timestamp reset hota hai. Invalid ya future timestamp bhi safely reset hota hai.

Six mocked tests pass hue. Real manual stop/start aur wake verify hue. Full natural idle-expiry-to-stop cycle deployment ke end tak observe nahi kiya gaya tha.

## 9. Secrets ka handling

| Local / remote item | Handling |
| --- | --- |
| `k8s/secrets.yml` | Local only; Git-ignored; original file upload/apply nahi ki |
| `portfolio/wake-code.local` | Local private wake code; Git-ignored |
| SSH `.pem` key | Existing private file outside repo; guide mein value nahi |
| `portfolio/rollback.local/` | Local recovery material; Git-ignored |
| Application Kubernetes Secrets | Required selected values SSH se provision hue |
| `portfolio-origin-tls` | Certificate/key ke liye separate Kubernetes TLS Secret |

Provisioner 5 application Secret objects validate karta hai:

```text
database   : auth DB, sandbox DB, Redis, RabbitMQ connection values
jwt        : JWT signing secret
google     : OAuth client ID / client secret
ai-secret  : configured AI provider keys
aws        : region, workspace bucket, required AWS credentials
```

`GOOGLE_REFRESH_TOKEN` required selection mein nahi hai. Email notifications skipped hain. `secrets.yml` ka naam ignore hona Docker image mein secrets safe hone ki guarantee nahi hai; build contexts aur `.dockerignore` exclusions bhi maintain karo.

Local validation, bina credentials print ya send kiye:

```powershell
node portfolio/provision-secrets.mjs --check
git check-ignore k8s/secrets.yml portfolio/wake-code.local portfolio/rollback.local/
```

Initial provisioning / fresh recovery target ke liye:

```powershell
node portfolio/provision-secrets.mjs --create ubuntu@43.205.61.128 C:/Users/dheer/Downloads/flowent-key.pem
```

`--create` remote Secret objects create karta hai. Existing names update/rotate karne ka command nahi hai; current server par blindly rerun karne se already-exists failure aa sakti hai. Secret rotation ke liye approved update process aur affected deployments ka restart chahiye.

Kubernetes Secret base64 encoding ko encryption mat samajhna. Cluster access aur secret backups ko protect karna zaroori hai. Is documentation/cleanup task mein cloud credentials ya live secrets change nahi kiye gaye.

## 10. Daily use aur useful commands

Windows commands repo ke `capstone` folder se run karo. AWS CLI, configured credentials, Node.js aur OpenSSH chahiye. Image build ke liye Docker chahiye. RTK installed ho to local shell commands ke aage `rtk proxy` use kar sakte ho.

### 10.1 Read-only AWS checks

```powershell
aws sts get-caller-identity
aws ec2 describe-instances --instance-ids i-0de960ffd53719da8 --region ap-south-1 --query 'Reservations[0].Instances[0].{State:State.Name,Type:InstanceType,PublicIP:PublicIpAddress}' --output table
aws cloudformation describe-stacks --stack-name flowent-portfolio-wake --region ap-south-1 --query 'Stacks[0].StackStatus' --output text
aws cloudfront get-distribution --id E1MTXFSZU81DQ4 --query 'Distribution.Status' --output text
```

Public API readiness:

```powershell
curl.exe -i https://www.projectrs.me/api/auth/me
```

Healthy unauthenticated response mein `loggedIn: false` aana normal hai. Backend sleep mein ho to pehle wake/start karo.

### 10.2 EC2 connect aur service checks

Windows:

```powershell
ssh -i C:/Users/dheer/Downloads/flowent-key.pem ubuntu@43.205.61.128
```

Connected Ubuntu shell:

```bash
sudo k3s kubectl get nodes
sudo k3s kubectl get deployments,pods,services,ingresses
sudo systemctl status k3s nginx flowent-idle.timer --no-pager
sudo systemctl list-timers flowent-idle.timer --all
sudo journalctl -u flowent-idle.service -n 50 --no-pager
sudo k3s kubectl logs deploy/sandbox-deployment --tail=100
```

Logs share karne se pehle connection strings, user data aur tokens redact karo. `kubectl get secrets -o yaml` ko routine troubleshooting output mat banao.

### 10.3 Manually start / stop

Yeh commands instance state change karte hain. Interview se pehle manual start useful hai:

```powershell
aws ec2 start-instances --instance-ids i-0de960ffd53719da8 --region ap-south-1
aws ec2 wait instance-running --instance-ids i-0de960ffd53719da8 --region ap-south-1
```

Wait command EC2 running tak wait karta hai; uske baad API readiness bhi check karo. Use khatam hone par stop karna ho:

```powershell
aws ec2 stop-instances --instance-ids i-0de960ffd53719da8 --region ap-south-1
```

Stop ke waqt active terminal connections tootenge. Unsynced workspace changes pehle save/sync karo. Stop aur terminate alag actions hain; terminate use mat karna jab server resume karna ho.

### 10.4 Long interview ke liye timer temporarily disable karna

EC2 ke Ubuntu shell mein:

```bash
sudo systemctl disable --now flowent-idle.timer
```

Session ke baad enable wapas karo. Reinstall command last-active timestamp reset karke grace window deta hai:

```bash
EXPECTED_INSTANCE_ID=i-0de960ffd53719da8 AWS_REGION=ap-south-1 \
  bash /home/ubuntu/capstone-deploy/portfolio/install-idle.sh
```

Timer disabled chhodne par EC2 running cost continue hogi.

## 11. Future release `v2`, `v3` kaise deploy karni hai?

Image ECR par push karna, Kubernetes mein deploy karna aur frontend publish karna teen separate steps hain. Sirf image push hone se live pods automatically update nahi hote.

### 11.1 Docker images build/push

Current release `v1` hai. Agli release ke liye unused numeric tag choose karo:

```powershell
powershell -NoProfile -File portfolio/build-push.ps1 -Tag v2
```

Script 8 repositories check karta hai. Kisi repo mein chosen tag already ho to overwrite karne ke bajay fail hota hai. Phir ECR login, Linux AMD64 build aur push karta hai.

Yeh overwrite protection script ke level par hai. Isse repository-wide ECR immutability automatically enabled assume mat karo. Purane working tags rollback ke liye preserve karo.

Release verify karo:

```powershell
aws ecr describe-images --repository-name auth --image-ids imageTag=v2 --region ap-south-1 --query 'imageDetails[0].{Tags:imageTags,Digest:imageDigest,PushedAt:imagePushedAt}' --output table
```

### 11.2 Backend rollout

VM staging directory mein selected updated non-secret deployment files hone chahiye. Application code image ke andar aata hai. Manifests ya scripts badle hon to unhi selected files ko upload karo; secrets, wake code aur rollback directory ko repo ke saath copy mat karo.

SSH ke baad Ubuntu par:

```bash
PORTFOLIO_INGRESS_CLASS=nginx PORTFOLIO_IMAGE_TAG=v2 \
  bash /home/ubuntu/capstone-deploy/portfolio/deploy.sh
```

`nginx` flag current reused VM ke liye zaroori hai. Script ka default `traefik` clean-instance alternative ke liye hai. Script ECR se images pre-pull karta hai, 4 deployments update karta hai, AI ko 1 replica rakhta hai aur future sandboxes ke image tag ko set karta hai.

Existing active sandbox pods apni purani images par reh sakte hain. Naya tag fresh sandbox creation mein use hota hai. Active user pods ko deployment ke naam par blindly delete mat karo.

Single VM deployment ke liye short maintenance window rakho. Rollout ke baad deployment image names aur public endpoints verify karo:

```bash
sudo k3s kubectl get deployments -o wide
sudo k3s kubectl get pods
```

### 11.3 Frontend build/publish

```powershell
powershell -NoProfile -File portfolio/build-frontend.ps1 -WakeApiUrl https://wtajdsltp5.execute-api.ap-south-1.amazonaws.com/v1
```

Output `frontend/dist-portfolio/` mein aata hai. Script build-time flags set karta hai:

```text
VITE_WAKE_API_URL=https://wtajdsltp5.execute-api.ap-south-1.amazonaws.com/v1
VITE_SANDBOX_HOST_STYLE=flat
VITE_RUNTIME_LABEL=K3S
```

Wake URL ka `/v1` API stage hai. App release `v2` hone par API stage ko automatically `/v2` mat karo.

Frontend-only release ke liye 8 backend images rebuild karna required nahi hai. New frontend ko separate prefix par upload karo:

```powershell
aws s3 sync frontend/dist-portfolio/ s3://flowent-frontend/portfolio/v2/ --region ap-south-1
```

S3 bucket root par `--delete` wali sync mat chalao. Current `v1` prefix aur older root rollback ke liye retained hain.

CloudFront console mein distribution `E1MTXFSZU81DQ4` open karo. S3 origin `S3-flowent-frontend` ka Origin path `/portfolio/v2` set karo. Existing API origin aur behaviors preserve karo. Deployment finish hone ke baad invalidate karo:

```powershell
aws cloudfront create-invalidation --distribution-id E1MTXFSZU81DQ4 --paths '/*'
```

Console ke bajay CLI se distribution update karo to pehle fresh config aur ETag read/save karo. Stale ETag aur original migration snapshot ko future release update mein reuse mat karo.

### 11.4 Wake stack code update

Sirf wake logic/template change ho tab redeploy chahiye. Local code file preserve karke:

```powershell
npm --prefix portfolio/wake ci
npm --prefix portfolio/wake test
powershell -NoProfile -File portfolio/deploy-wake.ps1 -InstanceId i-0de960ffd53719da8
```

Script generated `wake/packaged.yml` recreate karta hai. Package/deploy se S3 artifacts aur CloudFormation resources update hote hain. Normal app release ke liye wake stack redeploy karna required nahi hai.

## 12. Kya testing hui aur kya pending hai?

| Check | Deployment ke waqt result |
| --- | --- |
| 8 ECR images with `v1` | Built, pushed aur verified |
| 4 core deployments | Rollout successful |
| Frontend build | Passed; bundle-size warning only |
| Public HTML / JS / CSS | Local deployed artifact se exact comparison passed |
| Auth endpoint | Healthy response verified |
| Sandbox health / AI request validation | Passed; paid provider execution verify nahi hua |
| Disposable project + sandbox | Create aur readiness passed |
| Sandbox preview / agent HTTPS | Passed |
| WebSocket terminal | Command execute hua aur output mila |
| Workspace-to-S3 file sync | Passed |
| Disposable cleanup | Project, pod, service aur 26 stored object versions remove hue |
| Wake status / correct code | Passed |
| Wrong code / wrong Origin | Rejected as expected |
| Real EC2 stop/start | Tested; HTTPS ready after AppArmor fix |
| Idle safety tests | 6 mocked cases passed |
| Full natural idle shutdown cycle | Observe karna pending tha |
| Actual Google browser sign-in | User manual check pending |
| Actual paid AI provider request | User manual check pending |
| Real phone full workflow | Manual responsive/scroll check recommended |

### Verification commands aur unka impact

Wake unit tests local hain:

```powershell
npm --prefix portfolio/wake test
```

Ubuntu par idle safety tests mocked commands use karte hain; test actual EC2 stop call nahi karta:

```bash
bash /home/ubuntu/capstone-deploy/portfolio/idle-stop.test.sh
```

Wake integration verifier real start request bhejta hai. Isko chalane se stopped EC2 start ho sakta hai aur compute usage ho sakta hai:

```powershell
node portfolio/verify-wake.mjs https://wtajdsltp5.execute-api.ap-south-1.amazonaws.com/v1 43.205.61.128
```

Public end-to-end verifier real disposable project create/delete karta hai, terminal command chalata hai aur S3 write/check karta hai:

```powershell
node portfolio/verify-origin.mjs C:/Users/dheer/Downloads/flowent-key.pem 43.205.61.128 --public
```

`--public` mode ko wahi local `frontend/dist-portfolio/` build chahiye jo live deployed hai. Naya local build aur purana live frontend mismatch ho to comparison fail hona expected hai. Public publish ke baad matching artifact ke saath verify karo. Verifier temporary synthetic authentication use karta hai; yeh Google sign-in test ka replacement nahi hai.

## 13. Deployment mein kaunse errors aaye aur kaise solve hue?

### Lambda concurrency quota

Account optional reserved concurrency ko allow nahi kar raha tha. Stack rollback hua. Approval ke baad failed `ROLLBACK_COMPLETE` stack delete karke optional reservation remove ki aur retry ki. API throttling retained hai.

### API Gateway permissions

Wake deployment ke liye API management/tagging permissions missing the. `FlowentPortfolioWakeDeploy` inline policy update hui. Policy editor warning ke baad actual AWS deployment se permissions verify hui. Future failures ke liye CloudFormation events ka exact denied action/resource dekho; broad administrator policy se issue hide mat karo.

### Missing Google refresh token

Placeholder token deploy karne ke bajay email notification service skip ki. Auth ke required Google OAuth client credentials alag hain. Email refresh token na hone ka matlab poora auth service disable karna nahi tha.

### DNS access

AWS identity Namecheap DNS change nahi kar sakti thi. Exact target tumhe diya gaya aur wildcard A record tumne change kiya. Public DNS resolution verify hui.

### Reboot ke baad 502 / AppArmor

Installed runtime baseline mein k3s `v1.36.4+k3s1`, containerd `v2.3.4-k3s1.36`, kernel `7.0.0-1017-aws` aur AppArmor `5.0.2` the. Stacked peer profile par signal permission ki wajah se ingress reload fail hua.

Version-checked profile mein exact stacked-peer signal/ptrace rules add kiye. AppArmor disable nahi kiya. Kernel restriction enabled rakhi. Persistent profile `/etc/apparmor.d/cri-containerd.apparmor.d` mein hai. Baseline `/var/lib/flowent-portfolio/cri-containerd.baseline` par retained hai. Fix real boot ke baad verify hui.

Runtime upgrade ke baad workaround blindly reinstall mat karo; installer version guard isliye hai. Related upstream discussion: [containerd issue](https://github.com/containerd/containerd/issues/14485), [containerd fix](https://github.com/containerd/containerd/pull/14487).

### CloudFront optional error configuration

Additional 502/503/504 error-cache configuration AWS ne `IllegalUpdate` ke saath reject ki. Optional changes remove karke existing SPA error handling preserve ki gayi. Final deployed configuration ko saved candidate ke kisi abandoned version ke equal assume mat karo.

## 14. Purane EKS se kya delete hua?

Approval ke baad ye old infrastructure remove hua:

- EKS cluster `express-cluster`.
- Uske 2 `t3.medium` worker instances.
- Dono workers ke 80 GiB gp3 disks.
- Purana ingress Classic Load Balancer.
- Dedicated NAT gateway aur uska Elastic IP.
- Dedicated EKS VPC aur cluster-owned networking/resources.
- Cluster, nodegroup aur cluster-autoscaler ke eksctl CloudFormation stacks.
- Cluster-owned IAM/OIDC resources jo eksctl cleanup ka part the.

Deletion se pehle active EKS sandbox/PV/PVC na hone ka check kiya. Snapshot mein Kubernetes Secret objects copy nahi kiye. `eksctl` removal complete hua aur cluster/VPC absence verify hui.

Current EC2 demo separate VPC mein tha. EC2, uska Elastic IP, 16 GiB root disk, wake stack, S3 data aur ECR images preserve hue. EKS remove hone ke baad public API healthy verify hui.

**EKS ab pause state mein nahi hai. Wapas EKS use karne ke liye infrastructure recreate karna hoga.** Deleted worker disks recovery snapshot ke equivalent backups nahi hain; yahan retained EKS material configuration snapshots hain.

## 15. Is architecture ka monthly cost aur credit runway

14 November 2026 ke account-plan API check mein **USD 20 remaining credits** aur **Paid plan** mila. Earlier screenshot ka USD 42.84 us check ke liye current balance nahi tha. API ne credit expiry date return nahi ki.

Cost Explorer aur authenticated Price List API access available nahi tha. Isliye yeh planning estimate hai; itemized final AWS bill nahi hai.

Light demo use, roughly **10–20 powered-on EC2 hours per month**, ke liye planning budget **USD 7–10/month** rakha gaya. Is assumption par USD 20 credits roughly **2–3 months** chal sakte hain. Full-time EC2 running is estimate mein included nahi hai.

| Cost item | EC2 stop hone par kya hota hai? |
| --- | --- |
| Normal EC2 compute | Stopped time ka normal instance compute charge rukta hai |
| Retained Elastic IP / public IPv4 | Hourly charge continue hota hai |
| 16 GiB gp3 EBS | Disk retained hai, storage charge continue hota hai |
| ECR images | Retained image storage charge continue ho sakta hai |
| S3 / CloudFront / API Gateway / Lambda / logs | Usage, account plan aur allowances par depend |
| External AI / DB / domain | Unke provider aur plan ke hisaab se separate |

AWS public IPv4 published rate USD 0.005/hour hai. Ek retained IPv4 ka 730-hour month roughly USD 3.65 banta hai. EC2 stop karne se yeh fixed portion eliminate nahi hota. [VPC pricing](https://aws.amazon.com/vpc/pricing/)

Deployment inventory mein ECR image sizes ka sum approximately 8.11 GiB tha. Shared layers ki wajah se billable storage simple sum se kam ho sakta hai. Exact regional EBS/EC2 bill yahan independently verify nahi hua tha. [ECR pricing](https://aws.amazon.com/ecr/pricing/), [EC2 pricing](https://aws.amazon.com/ec2/pricing/on-demand/), [EBS pricing](https://aws.amazon.com/ebs/pricing/)

Traffic, longer EC2 uptime, CPU surplus credits, tax, external services aur credit expiry actual runway ko shorten kar sakte hain. **Paid account credits zero hone par automatic shutdown assume mat karo; billing continue ho sakti hai.** Billing console mein current balance/expiry aur budget alerts check karna hoga. Is migration mein zero-balance shutdown system deploy nahi kiya gaya.

Project ko technically months/years operate kar sakte ho, jab tak bills, domain, dependencies aur certificates maintain hote hain. Current credits par one-year free operation promise nahi hai. TLS deadline credit runway se alag hai.

## 16. Common problems ka troubleshooting

| Symptom | Pehla check / next action |
| --- | --- |
| Homepage khulta hai, login/API unavailable | EC2 state check; demo code se wake |
| EC2 running, phir bhi 502 | k3s/pods/ingress readiness aur Nginx logs inspect |
| Reboot ke baad ingress fail | AppArmor DENIED logs aur installed runtime/profile check |
| Wake form wrong code dikhata hai | Private local code use karo; code public share mat karo |
| Wake request 429 | Repeated requests roko; API throttling settle hone do |
| Certificate warning | Domain coverage, DNS target aur certificate expiry check |
| Preview hostname resolve nahi hota | Namecheap wildcard A record aur specific conflicting record check |
| Terminal disconnect hota hai | EC2 stop, sandbox expiry, pod readiness aur WebSocket proxy logs check |
| EC2 idle ke baad stop nahi hota | Remaining sandbox pods, Redis expiry logs, timer state check |
| Login ka redirect fail hota hai | Google OAuth allowed URLs aur app logs check |
| ECR tag push ho gaya, live app purani hai | Kubernetes rollout aur frontend publish alag se verify |
| Image pull fail | ECR auth, instance permissions, free disk aur exact numeric tag check |
| Mobile homepage scroll nahi hota | Live build/version aur landing-page overflow rules verify; old cache clear |

Ubuntu diagnostics:

```bash
sudo k3s kubectl get pods -A
sudo k3s kubectl get events --sort-by=.lastTimestamp
sudo journalctl -u k3s -n 100 --no-pager
sudo journalctl -u nginx -n 50 --no-pager
sudo journalctl -k --since '15 minutes ago' | grep -i apparmor
sudo nginx -t
df -h
```

Kisi failed pod ke liye `kubectl describe pod` aur relevant deployment logs dekho. Secret values ko error report mein paste mat karo. AppArmor issue ke liye poora security system disable karna current fix nahi hai.

## 17. Rollback kaise karna hai?

### 17.1 Previous app image release par jaana

Working tag aur selected manifests ka record rakho. `v2` deployment fail ho to VM staging se same deployment script `PORTFOLIO_IMAGE_TAG=v1` ke saath run kar sakte ho. Isse controller-managed workloads aur future sandbox tag previous version par aate hain.

Existing sandbox pods aur database migrations alag concerns hain. Data schema badla ho to image rollback alone enough nahi ho sakta. Is migration ne automatic data rollback system add nahi kiya.

### 17.2 Previous static frontend par jaana

CloudFront S3 Origin path ko previous known-working prefix, jaise `/portfolio/v1`, par set karo aur invalidate karo. API routing ko working EC2 backend par rehne do. Har release ka S3 prefix preserve rakhne se yeh revert easy hai.

Original S3 root build bhi retained hai, lekin old frontend backend assumptions alag ho sakti hain. Root par revert karne se pehle wake/hostname compatibility verify karo.

### 17.3 EKS architecture par wapas jaana

`portfolio/rollback.local/eks/` mein infrastructure templates aur non-secret configuration snapshots hain. Inko reconstruction reference samjho. Exported Kubernetes objects ko blindly reapply karne ke bajay current API versions aur environment values review karo.

1. EKS cluster, nodegroup aur required networking recreate karo.
2. Required secrets approved method se provision karo; snapshot mein Secret objects nahi hain.
3. Application images/manifests deploy karke new ingress load balancer verify karo.
4. New load balancer target ke saath DNS aur CloudFront API origin prepare karo.
5. Login, sandbox, preview, terminal, storage aur AI paths test karo.
6. Public traffic switch hone ke baad hi EC2 wake/idle setup retire karo.

**Saved `cloudfront-restore.json` aur old DNS targets directly apply mat karo. Woh deleted EKS load balancer ko refer karte hain.** Fresh target, current CloudFront config aur fresh ETag chahiye.

### 17.4 AppArmor workaround rollback

Repo mein `install-apparmor-fix.sh` aur reviewed profile retained hain. VM baseline `/var/lib/flowent-portfolio/cri-containerd.baseline` par hai. Compatible runtime upgrade ke baad workaround review karke remove kar sakte ho.

Original profile restore karne se current runtime par ingress reload bug wapas aa sakta hai. Persistent override ko `/etc/apparmor.d/` ke bahar safe backup mein move karne aur baseline reload karne se pehle runtime compatibility verify karo.

Poore dirty checkout par `git reset --hard` ya blanket file restore se pehle se existing changes lose ho sakte hain. Portfolio additions aur integration edits ko separately review karke revert karo.

## 18. Kaunsi files useful hain aur cleanup mein kya hua?

| File / folder | Purpose |
| --- | --- |
| `build-push.ps1` | Numeric tag ke saath 8 images build/push |
| `build-frontend.ps1` | Wake-enabled static frontend build |
| `deploy.sh` | Selected app manifests aur image rollout |
| `deploy-wake.ps1` | Wake stack package/deploy |
| `provision-secrets.mjs` | Local validation aur initial selected-secret provisioning |
| `ingress-nginx.yml` | Current existing VM ka ingress path |
| `ingress.yml`, `install-k3s.sh` | Separate clean-instance / Traefik alternative |
| `idle-stop.sh`, `install-idle.sh` | Idle shutdown aur installation |
| `flowent-idle.service`, `flowent-idle.timer` | systemd units |
| `idle-stop-policy.json` | Instance-scoped stop permission |
| `idle-stop.test.sh` | Mocked idle safety tests |
| `verify-wake.mjs` | Real wake/start + readiness verification |
| `verify-origin.mjs` | Disposable project end-to-end test |
| `wake/handler.mjs`, `wake/template.yml` | Wake application aur infrastructure source |
| `wake/handler.test.mjs` | Wake handler tests |
| `wake/deployer-iam-policy.json` | Deployment IAM policy reference |
| `apparmor/`, `install-apparmor-fix.sh` | Runtime compatibility fix |
| `rollback.local/` | Private local recovery snapshots |

Completed one-time migration scripts working folder se remove kiye:

- `backup-eks.mjs`: deleted EKS ka snapshot lene wala completed tool.
- `prepare-cutover.mjs`: original pre-cutover CloudFront state par based completed tool.
- `remove-old-k3s-app.sh`: purane application ka completed destructive migration tool.

In teen files ka recoverable archive `portfolio/rollback.local/migration-tools.zip` mein retained hai. ZIP ko extract karne se pehle code review karo; old targets aur assumptions ab valid nahi ho sakte.

Generated `portfolio/wake/packaged.yml` delete kiya. `deploy-wake.ps1` next deployment par ise recreate karta hai. Wake source/template aur dependency lockfile preserved hain.

`frontend/dist-portfolio/` retained hai kyunki public verifier current deployed artifact se compare karta hai. EKS manifests, existing app edits, local secrets, wake code aur rollback snapshots preserve kiye.

Cleanup local repository tak limited tha. Is documentation task mein remote VM files delete, cloud resources modify, deployment rerun ya GitHub push nahi kiya.

## 19. Interview se pehle quick checklist

1. EC2 wake/start karo aur `/api/auth/me` healthy hone do.
2. Actual Google sign-in browser mein check karo.
3. Ek project open karke preview, terminal aur file save verify karo.
4. AI demo chahiye to provider quota/key aur ek real request check karo.
5. Mobile par homepage bottom tak scroll karke workspace controls check karo.
6. Viewer ko wake code privately do, agar self-service wake chahiye.
7. Long session ke liye idle timer disable kiya ho to baad mein re-enable karo.
8. Certificate expiry aur current credits check karo.

## 20. Maintenance reminders

- Recorded EC2 TLS certificate ko **18 December 2026 se pehle renew** karo.
- Natural idle-stop aur next wake ko observe karke timing verify karo.
- Monthly AWS bill/credit expiry aur external provider quotas review karo.
- New releases ke liye unused `v2`, `v3`, `v4` tags aur separate frontend prefixes use karo.
- Working rollback images/prefixes delete karne se pehle current release verify karo.
- k3s/containerd upgrade par AppArmor workaround dobara review karo.
- Backup directory aur local secret files ka secure offline backup rakho.

No Git commit ya GitHub push is deployment/documentation work se kiya gaya. Local guide mein credentials include nahi hain.
