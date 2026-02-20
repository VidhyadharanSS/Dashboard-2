---
apiVersion: v1
kind: Namespace
metadata:
  name: opensearch
  labels:
    app: opensearch
    env: local-dev

---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: opensearch-pv
  namespace: opensearch
  labels:
    app: opensearch
    env: local-dev
spec:
  storageClassName: local-storage
  capacity:
    storage: 8Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  hostPath:
    path: /home/sas/volumes/weaviate-di/thiru-test
    type: DirectoryOrCreate

---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: opensearch-pvc
  namespace: opensearch
  labels:
    app: opensearch
    env: local-dev
spec:
  storageClassName: local-storage
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 8Gi
  selector:
    matchLabels:
      app: opensearch

---
apiVersion: v1
kind: Service
metadata:
  name: opensearch
  namespace: opensearch
  labels:
    app: opensearch
    env: local-dev
spec:
  selector:
    app: opensearch
  # Changed from ClusterIP to NodePort
  type: NodePort 
  ports:
    - name: http
      port: 9200
      targetPort: 9200
      nodePort: 30200 # Accessible at <NodeIP>:30200
      protocol: TCP
    - name: transport
      port: 9300
      targetPort: 9300
      nodePort: 30300 # Accessible at <NodeIP>:30300
      protocol: TCP


---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: opensearch
  namespace: opensearch
  labels:
    app: opensearch
    env: local-dev
spec:
  serviceName: opensearch
  podManagementPolicy: OrderedReady
  replicas: 1
  selector:
    matchLabels:
      app: opensearch
  template:
    metadata:
      labels:
        app: opensearch
        env: local-dev
    spec:
      imagePullSecrets:
       - name: regcred
      initContainers:
        - name: fix-permissions
          image: crmdi-test6.csez.zohocorpin.com/dev/busybox:latest
          command: ["sh", "-c", "chown -R 1000:1000 /usr/share/opensearch/data"]
          volumeMounts:
            - name: opensearch-data
              mountPath: /usr/share/opensearch/data
        - name: sysctl
          image: crmdi-test6.csez.zohocorpin.com/dev/busybox:latest
          command: ["sysctl", "-w", "vm.max_map_count=262144"]
          securityContext:
            privileged: true
      containers:
        - name: opensearch
          image: crmdi-test6.csez.zohocorpin.com/dev/opensearch:3.0.0
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 9200
              name: http
            - containerPort: 9300
              name: transport
          env:
            - name: cluster.name
              value: "opensearch-local"
            - name: node.name
              value: "opensearch-0"
            - name: discovery.type
              value: "single-node"
            - name: DISABLE_SECURITY_PLUGIN
              value: "true"
            - name: OPENSEARCH_JAVA_OPTS
              value: "-Xms512m -Xmx512m"
            - name: bootstrap.memory_lock
              value: "false"
          readinessProbe:
            httpGet:
              path: /_cluster/health
              port: 9200
              scheme: HTTP
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 6
          livenessProbe:
            httpGet:
              path: /_cluster/health
              port: 9200
              scheme: HTTP
            initialDelaySeconds: 60
            periodSeconds: 20
            failureThreshold: 5
          resources:
            requests:
              cpu: "500m"
              memory: "4Gi"
            limits:
              cpu: "4"
              memory: "8Gi"
          volumeMounts:
            - name: opensearch-data
              mountPath: /usr/share/opensearch/data
          securityContext:
            runAsUser: 1000
            runAsGroup: 1000
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
      volumes:
        - name: opensearch-data
          persistentVolumeClaim:
            claimName: opensearch-pvc
      terminationGracePeriodSeconds: 30
