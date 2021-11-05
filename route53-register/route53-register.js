'use strict'
const { EC2Client, DescribeInstancesCommand } = require('@aws-sdk/client-ec2')
const { Route53Client, ListHostedZonesByVPCCommand } = require('@aws-sdk/client-route-53')
const { WebClient } = require('@slack/web-api')
const SLACK_TOKEN = process.env.SLACK_TOKEN
const SLACK_CHANNEL = process.env.SLACK_CHANNEL

module.exports.register = async (event) => {
  if (event['detail']['state'] !== 'running') return false
  try {
    const resourceRecordSet = await createResourceRecordSet(event['detail']['instance-id'], event['region'])
    console.log(JSON.stringify(resourceRecordSet))
    try {
      let success = 'success'
      const response = await notifyToSlack(success)
      if (response) {
        return 'Finished.'
      } else {
        return 'Finished, but failed to notify to the slack channel.'
      }
    } catch (error) {
      throw error
    }
  } catch (error) {
    try {
      const response = await notifyToSlack(error)
      if (response) {
        return 'An error has occurred, but success to notify to the slack channel.'
      } else {
        return 'An error has occurred, and failed to notify to the slack channel.'
      }
    } catch (error) {
      throw error
    }
  }
}

const createResourceRecordSet = async (instanceId, region) => {
  try {
    const ec2InstanceResource = await getEC2InstanceResource(instanceId)
    const hostedZoneData = await getHostedZoneData(ec2InstanceResource.vpcId, region)
    const resourceRecordSet = {
      "Comment": `CREATE/UPDATE record ${ec2InstanceResource.hostName}.${hostedZoneData.domainName}`,
      "Changes": [
        {
          "Action": "UPSERT",
          "ResourceRecordSet": {
            "Name": `${ec2InstanceResource.hostName}.${hostedZoneData.domainName}`,
            "Type": "A",
            "TTL": 60,
            "ResourceRecords": [
              {
                "Value": ec2InstanceResource.privateIpAddress
              }
            ]
          }
        }
      ]
    }
    return resourceRecordSet
  } catch (error) {
    throw error
  }
}

const getEC2InstanceResource = async (instanceId) => {
  const client = new EC2Client()
  try {
    const response = await client.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }))
    const ec2InstanceResource = response.Reservations[0].Instances.map((instance) => {
      let resource = {}
      resource.vpcId = instance.VpcId
      resource.privateIpAddress = instance.PrivateIpAddress
      resource.hostName = instance.Tags.find((tag) => {
        if (tag.Key === "HostName") return tag
      }).Value
      return resource
    })[0]
    if (ec2InstanceResource.hostName === undefined) {
      throw new Error(`The tag "HostName" is not defined on the instance ${instanceId}`)
    }
    return ec2InstanceResource
  } catch (error) {
    throw error
  }
}

const getHostedZoneData = async (vpcId, vpcRegion) => {
  const client = new Route53Client()
  try {
    const response = await client.send(new ListHostedZonesByVPCCommand({ VPCId: vpcId, VPCRegion: vpcRegion }))
    const hostedZoneId = response.HostedZoneSummaries.map((hostedZone) => {
      return hostedZone.HostedZoneId
    })
    const domainName = response.HostedZoneSummaries.map((hostedZone) => {
      return hostedZone.Name
    })
    return { hostedZoneId: hostedZoneId, domainName: domainName }
  } catch (error) {
    throw error
  }
}

const notifyToSlack = async (payload) => {
  const client = new WebClient(SLACK_TOKEN)
  try {
    const response = await client.chat.postMessage({
      channel: SLACK_CHANNEL,
      username: 'route53-register',
      text: payload
    })
    if (response.ok) {
      return true
    } else {
      return false
    }
  } catch (error) {
    throw error
  }
}