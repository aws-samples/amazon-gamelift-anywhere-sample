#!/usr/bin/env python3

import boto3
import uuid
import time
import socket
import struct
import threading

num_of_tickets=2
matchmakingConfigName="abp-demo-config-multi-player-ticket"

clients = [] # List of clients
tickets = [] # List of tickets
threads = []
numOfPlayers=4
numOfTickets=2

gl_client = boto3.client('gamelift')

numOfConnected = 0

# Initialize game client attributes
for i in range (numOfPlayers):
  client = {}

  client['playerId'] = uuid.uuid4()
  client['TicketStatus'] = 'IDLE'
  client['ticketId'] = ''
  client['playerAttr'] = {'score': {'N': 1000 }}
  client['ipaddr'] = ''
  client['port'] = 0
  clients.append(client)

for i in range (numOfTickets):
  ticket = {}
  ticket['status'] = 'IDLE'
  ticket['ticketId'] = ''
  tickets.append(ticket)

# Start Matchmaking request
match_response = gl_client.start_matchmaking(
  ConfigurationName = matchmakingConfigName,
  Players = [ 
    { 'PlayerId' : str(clients[0]['playerId']), 'PlayerAttributes' : clients[0]['playerAttr'] },
    { 'PlayerId' : str(clients[1]['playerId']), 'PlayerAttributes' : clients[1]['playerAttr'] } 
  ]
)

print('[player #0, #1] start_matchmaking sent to Client Backend Service.')
tickets[0]['ticketId'] = match_response['MatchmakingTicket']['TicketId']


match_response = gl_client.start_matchmaking(
  ConfigurationName = matchmakingConfigName,
  Players = [ 
    { 'PlayerId' : str(clients[2]['playerId']), 'PlayerAttributes' : clients[2]['playerAttr'] },
    { 'PlayerId' : str(clients[3]['playerId']), 'PlayerAttributes' : clients[3]['playerAttr'] } 
  ]
)

print('[player #2, #3] start_matchmaking sent to Client Backend Service.')
tickets[1]['ticketId'] = match_response['MatchmakingTicket']['TicketId']

time.sleep(1)

# Wait until all matchmaking requests succeeded with 'COMPLETED'
numOfCompleted = 0

while numOfCompleted < 2 :
  for i in range (numOfTickets) :
    if tickets[i]['status'] != 'COMPLETED':
      match_response = gl_client.describe_matchmaking(TicketIds = [ tickets[i]['ticketId']])
      print(match_response)
      match_ticket = match_response['TicketList'][0]
      tickets[i]['status'] = match_ticket['Status']
      if tickets[i]['status'] == 'COMPLETED':
        print('ticket[', i,'] matchmaking completed')
        numOfCompleted = numOfCompleted + 1
      time.sleep(1)
     

print('skipping client connection to server part...')

