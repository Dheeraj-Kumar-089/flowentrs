#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tag="${PORTFOLIO_IMAGE_TAG:-v1}"
region="${AWS_REGION:-ap-south-1}"
registry="${ECR_REGISTRY:-360821545863.dkr.ecr.ap-south-1.amazonaws.com}"
ingress_class="${PORTFOLIO_INGRESS_CLASS:-traefik}"

if sudo k3s kubectl get ingress flowent-ingress >/dev/null 2>&1; then
  echo 'This node already hosts the original Flowent k3s app. Refusing to overwrite it.' >&2
  exit 1
fi

case "$ingress_class" in
  nginx) ingress_file=ingress-nginx.yml ;;
  traefik) ingress_file=ingress.yml ;;
  *) echo 'PORTFOLIO_INGRESS_CLASS must be nginx or traefik.' >&2; exit 1 ;;
esac

if [[ ! "$tag" =~ ^v[1-9][0-9]*$ ]]; then
  echo 'PORTFOLIO_IMAGE_TAG must be v1, v2, v3, ...' >&2
  exit 1
fi

for secret in database jwt google ai-secret aws portfolio-origin-tls; do
  if ! sudo k3s kubectl get secret "$secret" >/dev/null 2>&1; then
    echo "Missing Kubernetes secret: $secret. This script never applies k8s/secrets.yml." >&2
    exit 1
  fi
done

for image in ai-orchestration auth router sandbox template agent sync-agent; do
  if ! aws ecr describe-images --repository-name "$image" --image-ids "imageTag=$tag" --region "$region" >/dev/null; then
    echo "Missing ECR image: $image:$tag" >&2
    exit 1
  fi
done

# K3s containerd has no permanent ECR login. Pre-pull the pinned images before
# applying workloads; IfNotPresent then reuses them after future EC2 restarts.
ecr_password="$(aws ecr get-login-password --region "$region")"
for image in ai-orchestration auth router sandbox template agent sync-agent; do
  sudo k3s ctr -n k8s.io images pull --user "AWS:${ecr_password}" "$registry/$image:$tag" >/dev/null
done
unset ecr_password

for resource in rbac.yml ai-service.yml auth-service.yml router-service.yml sandbox-service.yml; do
  sudo k3s kubectl apply -f "$repo_root/k8s/$resource"
done

sudo k3s kubectl apply -f "$repo_root/k8s/ai-deployment.yml"
sudo k3s kubectl scale deployment/ai-deployment --replicas=1
for resource in auth-deployment.yml router-deployment.yml sandbox-deployment.yml; do
  sudo k3s kubectl apply -f "$repo_root/k8s/$resource"
done

sudo k3s kubectl apply -f "$repo_root/portfolio/$ingress_file"
sudo k3s kubectl set image deployment/ai-deployment ai-server="$registry/ai-orchestration:$tag"
sudo k3s kubectl set image deployment/auth-deployment auth-container="$registry/auth:$tag"
sudo k3s kubectl set image deployment/router-deployment router-server="$registry/router:$tag"
sudo k3s kubectl set image deployment/sandbox-deployment main-sandbox-container="$registry/sandbox:$tag"
sudo k3s kubectl set env deployment/sandbox-deployment SANDBOX_HOST_STYLE=flat SANDBOX_IMAGE_TAG="$tag" ECR_REGISTRY="$registry"

for workload in ai-deployment auth-deployment router-deployment sandbox-deployment; do
  sudo k3s kubectl rollout status "deployment/$workload" --timeout=240s
done
