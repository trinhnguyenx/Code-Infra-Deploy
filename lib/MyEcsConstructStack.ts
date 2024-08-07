import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";

import * as dotenv from "dotenv";
dotenv.config();

export class MyEcsConstructStack  extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const ACM_ARN = process.env.CERTIFICATE_ARN!;
    const PORT = process.env.PORT!;
    const MONGO_URL = process.env.DATABASE_URL!;
    const ECR_REPO = process.env.ECR_REPO!;

    // Create VPC with public subnets
    const vpc = new ec2.Vpc(this, "MyVpc", {
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public-subnet",
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],    
    });

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, "MyCluster", {
      vpc: vpc,
    });

    // Take ECR Repository
    const repository = ecr.Repository.fromRepositoryArn(
      this,
      "sgroup-devops",
      ECR_REPO
    );

    // Create Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, "MyTaskDefinition", {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    // Add container to task definition
    const container = taskDefinition.addContainer("MyContainer", {
      image: ecs.ContainerImage.fromEcrRepository(repository, "latest"),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "my-container" }),
      environment: {
        DATABASE_URL: MONGO_URL,
        PORT: PORT,
      },
    });

    container.addPortMappings({
      containerPort: 3000,
    });

    // Security Group for ECS Service
    const ecsSecurityGroup = new ec2.SecurityGroup(this, "EcsSecurityGroup", {
      vpc,
      allowAllOutbound: true,
    });

    ecsSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3000),
      "Allow traffic on port 3000"
    );
    ecsSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow inbound HTTP traffic on port 80"
    );
    ecsSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow inbound HTTPS traffic on port 443"
    );
    ecsSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      "Allow inbound SSH traffic on port 22"
    );

    // Create ECS Service
    const service = new ecs.FargateService(this, "MyService", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      securityGroups: [ecsSecurityGroup],
    });

    // Create Application Load Balancer
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "MyALB", {
      vpc,
      internetFacing: true,
      securityGroup: ecsSecurityGroup,
    });

    // Create Application Target Group
    const httpstargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "MyhttpsTargetGroup",
      {
        vpc,
        protocol: elbv2.ApplicationProtocol.HTTP,
        port: 3000,
        targets: [service],
        healthCheck: {
          path: "/health",
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 2,
        },
      }
    );

    // Add HTTPS Listener
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      "MyCertificate",
      ACM_ARN
    );

    loadBalancer.addListener("HTTPSListener", {
      port: 443,
      certificates: [certificate],
      defaultTargetGroups: [httpstargetGroup],
    });

    // Add redirect from HTTP to HTTPS
    loadBalancer.addListener("HTTPListener", {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: "HTTPS",
        port: "443",
        permanent: true,
      }),
    });
  }
}
