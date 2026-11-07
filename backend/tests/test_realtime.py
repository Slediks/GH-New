from backend.app import socketio
from backend.tests.conftest import sign_in


def test_socket_requires_session_and_private_balances_are_isolated(client, database):
    anonymous = socketio.test_client(client.application)
    assert not anonymous.is_connected()
    user, _ = sign_in(client, "socket-alice")
    alice = socketio.test_client(client.application, flask_test_client=client)
    second_http = client.application.test_client()
    sign_in(second_http, "socket-bob")
    bob = socketio.test_client(client.application, flask_test_client=second_http)
    socketio.emit("balance", {"balance": 12345}, room=f"user:{user['id']}")
    assert alice.get_received()[0]["args"][0]["balance"] == 12345
    assert bob.get_received() == []
    alice.disconnect()
    bob.disconnect()
