#!/usr/bin/env python3

import boto3
import uuid
import time
import socket
import struct
import threading

numOfPlayers = 2
matchmakingConfigName="MatchmakingConfiguration"

clients = [] # List of client
threads = []

PKT_CS_START        = 1
PKT_SC_START        = 2
PKT_CS_PUT_STONE    = 21
PKT_SC_BOARD_STATUS = 22
PKT_CS_EXIT         = 31
PKT_CS_PING	        = 41

PKT_CS_START_SIZE   = 132 # size(2) + type(2) + playerID(128)
PKT_CS_EXIT_SIZE    = 132 # size(2) + type(2) + playerID(128)
PKT_SC_START_SIZE   = 196 # size(2) + type(2) + playerID(128) + opponentName(64)
PKT_CS_PING_SIZE    = 132 # size(2) + type(2) + playerID(128)

is_exiting = False

def thread_function(client, i):
  sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
  # Enable TCP Keep alive. AWS Global Accelerator has TCP idle timeout of 340s 
  sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
# sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPALIVE, 1) # TCP_KEEPALIVE not supported on MAC
  sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPINTVL, 30)
  sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPCNT, 3)

  addr = (client['ipaddr'], client['port'])
  sock.connect(addr)
  print('[player', i, '] connected to game server')

  var = struct.pack('hh128s', PKT_CS_START_SIZE, PKT_CS_START, bytes(str(client['sessionId']['PlayerSessionId']), encoding='utf-8'))
  #print(var)
  sock.send(var);
  print('[player', i, '] StartRequest sent to game server')

  try:
    data = sock.recv(PKT_SC_START_SIZE)
    if not data:
      print('[player', i, '] no data recevied')
    else:
      print('[player', i, '] GameStartBroadcast received')
  except ConnectionResetError as e:
    print('[player', i,'] error', e)

  t = 0 
  while t < 30:
    if is_exiting == True: 
      var = struct.pack('hh128s', PKT_CS_EXIT_SIZE, PKT_CS_EXIT, bytes(str(client['sessionId']['PlayerSessionId']), encoding='utf-8'))
      sock.send(var);
      print('[player', i, '] ExitRequest sent to game server')
      sock.close
      break

    t = t + 1
    if t == 30 : # send ClientPing every 30 sec.
      #var = struct.pack('hh128s', PKT_CS_PING_SIZE , PKT_CS_PING, bytes(str(client['sessionId']['PlayerSessionId']), encoding='utf-8'))
      #sock.send(var);
      print('[player', i,'] ClientPing sent to server skipped...')
      t = 0
    time.sleep(1)


gl_client = boto3.client('gamelift', region_name='ap-northeast-2')

#playerAttr = {'score': {'N': 1000 }}
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
  
# Start Matchmaking request
for i in range (numOfPlayers):
  match_response = gl_client.start_matchmaking(
    ConfigurationName = matchmakingConfigName,
    Players = [ { 'PlayerId' : str(clients[i]['playerId']), 'PlayerAttributes' : clients[i]['playerAttr'] } ]
  )
  print("[player", i, "] start_matchmaking sent to Client Backend Service.")
  clients[i]['ticketId'] = match_response['MatchmakingTicket']['TicketId']
  print("ticketID:", clients[i]['ticketId'])
  time.sleep(0.3)

time.sleep(1)

# Wait until all matchmaking requests succeeded with 'COMPLETED'
while numOfConnected < numOfPlayers :
  for i in range (numOfPlayers):
    if clients[i]['TicketStatus'] != 'COMPLETED': 
      match_response = gl_client.describe_matchmaking( TicketIds = [ clients[i]['ticketId']])
      match_ticket = match_response['TicketList'][0]
      clients[i]['TicketStatus'] = match_ticket['Status']
      print(match_response)
      if clients[i]['TicketStatus'] == 'COMPLETED':
        clients[i]['ipaddr']       = match_ticket['GameSessionConnectionInfo']['IpAddress']
        clients[i]['port']         = match_ticket['GameSessionConnectionInfo']['Port']
        clients[i]['sessionId']    = match_ticket['GameSessionConnectionInfo']['MatchedPlayerSessions'][0]
        print("[player", i, "][score:", clients[i]['playerAttr']['score']['N'], "] match created: ", clients[i]['ipaddr'], clients[i]['port'])

        numOfConnected = numOfConnected + 1
      else: 
        print("[player", i, "][score:", clients[i]['playerAttr']['score']['N'], "] matchmaking status: ", clients[i]['TicketStatus'])
      time.sleep(1)

# Start thread for each client to communicate with game server 
for i in range (numOfPlayers):
  try: 
    t = threading.Thread(target = thread_function, args = (clients[i], i))
    t.start()
    threads.append(t)
  except:
    print('error: unable to start thread')

time.sleep(1)
input("Please enter any key to terminate game sessions: \n")
is_exiting = True

for i, t in enumerate(threads) :
  t.join()
  print('[player', i, '] thread done')
    
print("Exiting...")
